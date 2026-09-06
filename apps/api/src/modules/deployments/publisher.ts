import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildManifest, renderDocumentHtml } from '@mad/export';
import type { Deployment, MadDocument, Project } from '@mad/schema';
import { ENV, type Env } from '../../config/env';

export interface PublishInput {
  deployment: Deployment;
  project: Project;
  document: MadDocument;
  /** Deep link back to the project in the studio, for the page badge. */
  studioUrl: string | null;
}

export interface PublishResult {
  /** Public URL of the deployed page (with trailing slash). */
  url: string;
  /** Directory the page was written to. */
  dir: string;
  bytes: number;
  /** Result of fetching the public URL after publishing; null when not attempted. */
  verified: boolean | null;
}

const SHORT = 8;

/**
 * Writes a rendered document to the static site root that the studio's web
 * server (IIS in the fleet) serves under `/apps`. Production deploys own a
 * stable folder per project and are replaced in place; previews are immutable
 * snapshots under `p/<deployment>`. Files are written next to their final name
 * and renamed into place so a reader never sees a half-written page.
 */
@Injectable()
export class SitePublisher {
  private readonly logger = new Logger('Publisher');
  readonly root: string;
  readonly publicBase: string;
  /** True when the API itself must serve the export root (no fleet base configured). */
  readonly servesLocally: boolean;

  constructor(@Inject(ENV) env: Env) {
    this.root = resolve(env.DEPLOY_EXPORT_ROOT ?? join(process.cwd(), 'exports'));
    this.servesLocally = !env.DEPLOY_PUBLIC_BASE;
    this.publicBase = (env.DEPLOY_PUBLIC_BASE ?? `http://localhost:${env.PORT}/exports`).replace(/\/+$/, '');
  }

  /** Folder (relative to the root) a deployment lands in. */
  relativePath(project: Project, deployment: Deployment): string {
    const base = `${project.slug}-${project.id.slice(0, 6)}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
    return deployment.target === 'production' ? base : `${base}/p/${deployment.id.slice(0, SHORT)}`;
  }

  urlFor(project: Project, deployment: Deployment): string {
    return `${this.publicBase}/${this.relativePath(project, deployment)}/`;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const rel = this.relativePath(input.project, input.deployment);
    const dir = resolve(this.root, rel);
    if (!this.inside(dir)) throw new Error(`Refusing to publish outside the export root: ${dir}`);
    await mkdir(dir, { recursive: true });

    const deployedAt = new Date().toISOString();
    const options = {
      title: input.project.name,
      description: input.project.description ?? `${input.project.name} — built with MAD Studio`,
      target: input.deployment.target,
      version: input.deployment.documentVersion,
      deployedAt,
      deploymentId: input.deployment.id,
      ...(input.studioUrl ? { studioUrl: input.studioUrl } : {}),
    };
    const html = renderDocumentHtml(input.document, options);
    const manifest = JSON.stringify({ ...buildManifest(input.document, options), url: this.urlFor(input.project, input.deployment), projectId: input.project.id }, null, 2);

    await this.writeAtomic(join(dir, 'index.html'), html);
    await this.writeAtomic(join(dir, 'manifest.json'), manifest);
    await this.writeAtomic(join(dir, 'document.json'), JSON.stringify(input.document));

    // Read back what a web server will serve, so "live" means the bytes are really there.
    const written = await readFile(join(dir, 'index.html'), 'utf8');
    if (!written.includes(`data-mad-deployment="${input.deployment.id}"`)) throw new Error('Published page failed read-back verification.');
    const bytes = (await stat(join(dir, 'index.html'))).size;

    const url = this.urlFor(input.project, input.deployment);
    const verified = this.servesLocally ? null : await this.verify(url, input.deployment.id);
    this.logger.log(`Published ${input.deployment.target} ${input.deployment.id} → ${url} (${bytes} bytes${verified === null ? '' : verified ? ', verified over HTTP' : ', HTTP verification failed'})`);
    return { url, dir, bytes, verified };
  }

  /** Removes a preview snapshot; production folders are kept because their URL is stable. */
  async remove(project: Project, deployment: Deployment): Promise<void> {
    if (deployment.target !== 'preview') return;
    const dir = resolve(this.root, this.relativePath(project, deployment));
    if (this.inside(dir)) await rm(dir, { recursive: true, force: true });
  }

  private async verify(url: string, deploymentId: string): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetch(url, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'mad-studio-publisher/1.0' } });
        if (res.ok && (await res.text()).includes(`data-mad-deployment="${deploymentId}"`)) return true;
        this.logger.warn(`Verify ${url}: HTTP ${res.status} (attempt ${attempt + 1})`);
      } catch (error) {
        this.logger.warn(`Verify ${url}: ${error instanceof Error ? error.message : String(error)} (attempt ${attempt + 1})`);
      }
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
    return false;
  }

  private async writeAtomic(file: string, content: string): Promise<void> {
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, file);
  }

  private inside(dir: string): boolean {
    const root = this.root.endsWith(sep) ? this.root : this.root + sep;
    return isAbsolute(dir) && (dir === this.root || dir.startsWith(root));
  }
}
