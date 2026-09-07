import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { ApiRequestError } from '../../core/api/api-client';
import { AuthDialog } from './auth-dialog.component';
import { anAuthState, fakeApiClient, studioProviders, type FakeApiClient } from '../../testing/studio-harness';

/**
 * The sign-in sheet is the only gate between a visitor and their work, so it has
 * to state what it needs, refuse what it cannot use, say why a attempt failed,
 * and always leave a way out that does not require an account.
 */
describe('AuthDialog', () => {
  let api: FakeApiClient;

  const render = () => {
    const fixture = TestBed.createComponent(AuthDialog);
    fixture.detectChanges();
    return fixture;
  };
  const auth = () => TestBed.inject(AuthService);
  const el = (fixture: { nativeElement: HTMLElement }, sel: string) => fixture.nativeElement.querySelector(sel) as HTMLElement | null;
  const inputs = (fixture: { nativeElement: HTMLElement }) => [...fixture.nativeElement.querySelectorAll('input')] as HTMLInputElement[];
  const submit = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement.querySelector('button[type=submit]') as HTMLButtonElement;
  /** requireSession may probe the session first; the sheet only exists once that settles. */
  const waitForSheet = async () => {
    for (let i = 0; i < 50 && !TestBed.inject(AuthService).dialogOpen(); i += 1) await Promise.resolve();
  };
  const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  beforeEach(() => {
    api = fakeApiClient({ configured: true });
    TestBed.configureTestingModule({ providers: studioProviders(api) });
  });

  it('asks only for what each mode needs', () => {
    const fixture = render();
    expect(inputs(fixture)).toHaveLength(2);
    expect(el(fixture, '#auth-title')?.textContent).toContain('Sign in');

    const tabs = [...fixture.nativeElement.querySelectorAll('[role=tab]')] as HTMLButtonElement[];
    tabs[1]?.click();
    fixture.detectChanges();
    expect(inputs(fixture)).toHaveLength(3);
    expect(el(fixture, '#auth-title')?.textContent).toContain('Create your account');
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('carries the autofill hints a password manager needs', () => {
    const fixture = render();
    const [email, password] = inputs(fixture);
    expect(email?.getAttribute('autocomplete')).toBe('email');
    expect(email?.type).toBe('email');
    expect(password?.getAttribute('autocomplete')).toBe('current-password');

    ([...fixture.nativeElement.querySelectorAll('[role=tab]')] as HTMLButtonElement[])[1]?.click();
    fixture.detectChanges();
    expect(inputs(fixture)[2]?.getAttribute('autocomplete')).toBe('new-password');
  });

  it('refuses to submit until the form can succeed', () => {
    const fixture = render();
    expect(submit(fixture).disabled).toBe(true);

    const [email, password] = inputs(fixture);
    type(email!, 'not-an-email');
    type(password!, 'whatever');
    fixture.detectChanges();
    expect(submit(fixture).disabled).toBe(true);

    type(email!, 'ada@example.com');
    fixture.detectChanges();
    expect(submit(fixture).disabled).toBe(false);
  });

  it('holds a new account to the longer password the API requires', () => {
    const fixture = render();
    ([...fixture.nativeElement.querySelectorAll('[role=tab]')] as HTMLButtonElement[])[1]?.click();
    fixture.detectChanges();
    const [name, email, password] = inputs(fixture);
    type(name!, 'Ada');
    type(email!, 'ada@example.com');
    type(password!, 'short');
    fixture.detectChanges();
    expect(submit(fixture).disabled).toBe(true);

    type(password!, 'long-enough-password');
    fixture.detectChanges();
    expect(submit(fixture).disabled).toBe(false);
  });

  it('explains a rejected sign-in where a screen reader will hear it', async () => {
    api.login.mockRejectedValueOnce(new ApiRequestError({ statusCode: 401, code: 'invalid_credentials', message: 'nope', requestId: 'r' }, 401));
    const fixture = render();
    const [email, password] = inputs(fixture);
    type(email!, 'ada@example.com');
    type(password!, 'wrong-password');
    fixture.detectChanges();

    submit(fixture).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const alert = el(fixture, '[role=alert]');
    expect(alert?.textContent).toContain('do not match');
    expect(auth().status()).not.toBe('authenticated');
  });

  it('signs in and closes on success', async () => {
    api.login.mockResolvedValueOnce(anAuthState());
    const fixture = render();
    const [email, password] = inputs(fixture);
    type(email!, 'ada@example.com');
    type(password!, 'correct-password');
    fixture.detectChanges();

    submit(fixture).click();
    await fixture.whenStable();

    expect(api.login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'correct-password' });
    expect(auth().status()).toBe('authenticated');
    expect(auth().dialogOpen()).toBe(false);
  });

  it('lets someone continue without an account, and tells the caller they did', async () => {
    auth().status.set('anonymous');
    const pending = auth().requireSession();
    await waitForSheet();
    const fixture = render();
    const escape = [...fixture.nativeElement.querySelectorAll('button')].find((b) => b.textContent?.includes('browser mode')) as HTMLButtonElement;
    expect(escape).toBeDefined();

    escape.click();
    await expect(pending).resolves.toBe(false);
    expect(auth().dialogOpen()).toBe(false);
  });

  it('opens the sheet only after an unknown session has been probed', async () => {
    const pending = auth().requireSession();
    expect(auth().dialogOpen()).toBe(false);
    await waitForSheet();
    expect(auth().dialogOpen()).toBe(true);
    auth().dismissDialog();
    await expect(pending).resolves.toBe(false);
  });

  it('closes on Escape, so the sheet is never a trap', async () => {
    auth().status.set('anonymous');
    const pending = auth().requireSession();
    await waitForSheet();
    render();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(pending).resolves.toBe(false);
  });
});
