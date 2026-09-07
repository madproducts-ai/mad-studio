import { Inject, Injectable } from '@nestjs/common';
import type { CreateProjectRequest, MadDocument, Project, ProjectDocument, SaveDocumentRequest } from '@mad/schema';
import { MadDocumentSchema } from '@mad/schema';
import { NotFoundError, StateError } from '../../common/errors';
import { REPOSITORY, type Repository, type Page } from '../../repositories/repository';

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'project';

@Injectable()
export class ProjectsService {
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  list(workspaceId: string, limit: number, cursor: string | null): Promise<Page<Project>> {
    return this.repo.projects.list(workspaceId, { limit, cursor });
  }

  async get(workspaceId: string, id: string): Promise<Project> {
    const project = await this.repo.projects.findById(id);
    if (!project || project.workspaceId !== workspaceId) throw new NotFoundError('Project', id);
    return project;
  }

  async create(workspaceId: string, input: CreateProjectRequest): Promise<Project> {
    const slug = await this.uniqueSlug(workspaceId, input.name);
    return this.repo.projects.create({ workspaceId, name: input.name, slug, description: input.description ?? null, designSystem: input.designSystem });
  }

  private async uniqueSlug(workspaceId: string, name: string): Promise<string> {
    const base = slugify(name);
    let slug = base;
    let n = 2;
    while (await this.repo.projects.slugExists(workspaceId, slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    return slug;
  }

  /**
   * Adopts the name the planner chose for a project created moments earlier from
   * a placeholder. The slug moves with the name, because it is what the public
   * deployment URL is built from; leaving it behind would publish the app under
   * a name nobody chose. Only ever called before the project has been deployed.
   */
  async adoptPlannedIdentity(projectId: string, name: string, description: string): Promise<Project | null> {
    const project = await this.repo.projects.findById(projectId);
    if (!project) return null;
    const slug = await this.uniqueSlug(project.workspaceId, name);
    return this.repo.projects.update(projectId, { name, description, slug });
  }

  async rename(workspaceId: string, id: string, name: string, description: string | null): Promise<Project> {
    await this.get(workspaceId, id);
    return this.repo.projects.update(id, { name, description });
  }

  async archive(workspaceId: string, id: string): Promise<Project> {
    await this.get(workspaceId, id);
    return this.repo.projects.update(id, { status: 'archived' });
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    await this.get(workspaceId, id);
    await this.repo.projects.delete(id);
  }

  async latestDocument(workspaceId: string, id: string): Promise<ProjectDocument> {
    await this.get(workspaceId, id);
    const doc = await this.repo.documents.latest(id);
    if (!doc) throw new StateError('This project has no document yet. Run a generation first.', { projectId: id });
    return doc;
  }

  async documentHistory(workspaceId: string, id: string, limit: number): Promise<ProjectDocument[]> {
    await this.get(workspaceId, id);
    return this.repo.documents.history(id, limit);
  }

  async saveDocument(workspaceId: string, id: string, input: SaveDocumentRequest): Promise<ProjectDocument> {
    await this.get(workspaceId, id);
    const document: MadDocument = MadDocumentSchema.parse({ ...input.document, updatedAt: new Date().toISOString() });
    return this.repo.documents.append(id, input.baseVersion, document, 'user', null);
  }
}
