import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Icon, type IconName } from '../core/ui/icon.component';
import { Magnetic } from '../core/motion/magnetic.directive';
import { Reveal } from '../core/motion/reveal.directive';
import { Tilt } from '../core/motion/tilt.directive';
import { prefersReducedMotion } from '../core/motion/motion';
import { SiteNav } from './site-nav.component';
import { SiteFooter } from './site-footer.component';
import { AmbientCanvas } from './ambient-canvas.component';
import { LiveDemo } from './live-demo.component';
import { LibraryShowcase } from './library-showcase.component';

interface Feature {
  icon: IconName;
  title: string;
  body: string;
  span: 'wide' | 'tall' | 'normal';
  demo: 'prompt' | 'inspector' | 'devices' | 'schema' | 'integrations' | 'deploy';
}

@Component({
  selector: 'mad-landing',
  imports: [RouterLink, FormsModule, Icon, Magnetic, Reveal, Tilt, SiteNav, SiteFooter, AmbientCanvas, LiveDemo, LibraryShowcase],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './landing.page.html',
  styleUrl: './landing.page.css',
  host: { class: 'block' },
})
export class LandingPage {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly heroRef = viewChild<ElementRef<HTMLElement>>('hero');

  protected readonly prompt = signal('');
  protected readonly submitting = signal(false);

  protected readonly suggestions = [
    'Internal CRM dashboard with Stripe billing and support chat',
    'Marketplace with product catalog, orders and inventory',
    'Task board with sprints, roles and Slack notifications',
    'Landing page and waitlist for a coffee subscription',
  ];

  protected readonly stats = [
    { value: '<60s', label: 'prompt to live preview' },
    { value: '23×3', label: 'presets across Tailwind, Material, WordPress' },
    { value: '20', label: 'integrations wired from a sentence' },
    { value: '100%', label: 'of generated UI editable by hand' },
  ];

  protected readonly features: Feature[] = [
    { icon: 'sparkles', title: 'One sentence in, a running app out', body: 'The planner reads intent, not keywords: CRM, billing, support, auth. It scaffolds the shell, composes each capability, then streams the interface onto the canvas node by node.', span: 'wide', demo: 'prompt' },
    { icon: 'mouse-pointer', title: 'Click anything, change everything', body: 'Every generated element is a real node with typed props. Select it, and the inspector exposes content, data, layout and style with undo history.', span: 'normal', demo: 'inspector' },
    { icon: 'smartphone', title: 'Real device previews', body: 'Desktop 1440, iPad Pro, iPhone 15 Pro and Pixel 8 frames at true CSS pixel widths, so responsive behaviour is authentic, not scaled.', span: 'normal', demo: 'devices' },
    { icon: 'database', title: 'A schema you would have written', body: 'Tables, columns, foreign keys and indices appear as the plan executes. PostgreSQL underneath, exportable as SQL migrations.', span: 'wide', demo: 'schema' },
    { icon: 'plug', title: 'Integrations, pre-wired', body: 'Stripe, HubSpot, Supabase Auth, Resend, Slack and more, with scopes declared and webhook handlers stubbed with retry logic.', span: 'normal', demo: 'integrations' },
    { icon: 'rocket', title: 'Deploy from the same canvas', body: 'Preview and production targets, versioned documents, one-click rollback. The URL is live before your coffee cools.', span: 'wide', demo: 'deploy' },
  ];

  protected readonly workflow = [
    { n: '01', title: 'Describe', body: 'Type what the product does. Name the integrations you already pay for. Pick a design system or let the planner choose.' },
    { n: '02', title: 'Watch it assemble', body: 'The interface streams in under a minute with a visible build plan: shell, capabilities, schema, integrations, polish.' },
    { n: '03', title: 'Refine by hand', body: 'Drag presets from the library, edit any prop, re-prompt a single section. Every change is versioned and reversible.' },
    { n: '04', title: 'Ship', body: 'Deploy to a preview URL, invite the team, promote to production. Export the code and the schema whenever you want.' },
  ];

  protected readonly integrations = ['Stripe', 'HubSpot', 'Salesforce', 'Supabase', 'PostgreSQL', 'Clerk', 'Auth0', 'Resend', 'Twilio', 'Slack', 'Segment', 'PostHog', 'Intercom', 'Shopify', 'Google Calendar', 'Paddle', 'S3', 'Pipedrive'];

  constructor() {
    afterNextRender(() => {
      if (prefersReducedMotion()) return;
      gsap.registerPlugin(ScrollTrigger);
      const hero = this.heroRef()?.nativeElement;
      if (!hero) return;
      const ctx = gsap.context(() => {
        gsap.to('.hero-glow', {
          yPercent: 30,
          scale: 1.15,
          ease: 'none',
          scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
        });
        gsap.to('.hero-copy', {
          yPercent: -12,
          opacity: 0.35,
          ease: 'none',
          scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
        });
        gsap.utils.toArray<HTMLElement>('.parallax-card').forEach((el, i) => {
          gsap.fromTo(el, { y: 24 + i * 6 }, { y: -12 - i * 4, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 0.6 } });
        });
      }, hero.parentElement ?? hero);
      this.destroyRef.onDestroy(() => ctx.revert());
    });
  }

  protected async submit(event?: Event): Promise<void> {
    event?.preventDefault();
    const text = this.prompt().trim();
    if (text.length < 4) {
      // Empty prompt: guide the user into the field instead of dead-clicking a disabled button.
      (document.getElementById('hero-prompt') as HTMLInputElement | null)?.focus();
      return;
    }
    if (this.submitting()) return;
    this.submitting.set(true);
    await this.router.navigate(['/studio'], { queryParams: { prompt: text } });
    this.submitting.set(false);
  }

  protected use(suggestion: string): void {
    this.prompt.set(suggestion);
    void this.submit();
  }
}
