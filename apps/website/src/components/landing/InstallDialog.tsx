'use client';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { AngularMark, ReactMark } from '../ui/FrameworkMarks';
import { trackCtaClick } from '../../lib/analytics/client';
import { observeInstallCopy } from '../../lib/growth/website-collector';
import {
  COMPONENT_SNIPPET,
  HERO_PRIMARY_LABEL,
  HERO_TRUST_LINE,
  INSTALL_OPTIONS,
  GITHUB_REPO_URL,
  type InstallVariant,
} from '../../lib/positioning';

interface InstallDialogProps {
  open: boolean;
  onClose: () => void;
}

const COPY_FEEDBACK_MS = 1500;
const TITLE_ID = 'install-dialog-title';

export function InstallDialog({ open, onClose }: InstallDialogProps) {
  const [framework, setFramework] = useState<'angular' | 'react'>('angular');
  const [variant, setVariant] = useState<InstallVariant>('fake');
  const [copied, setCopied] = useState(false);
  const frameworkRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const copyContext = useRef('');
  copyContext.current = `${framework}:${variant}`;
  const panelId = useId();
  const option =
    INSTALL_OPTIONS.find((o) => o.key === variant) ?? INSTALL_OPTIONS[0];
  const componentSnippet =
    variant === 'ag_ui'
      ? COMPONENT_SNIPPET.replace(
          "from '@threadplane/langgraph'",
          "from '@threadplane/ag-ui'"
        )
      : COMPONENT_SNIPPET;

  useEffect(() => {
    setCopied(false);
    clearTimeout(feedbackTimer.current);
    return () => clearTimeout(feedbackTimer.current);
  }, [framework, variant, open]);

  const onFrameworkKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
    setFramework(next === 0 ? 'angular' : 'react');
    frameworkRefs.current[next]?.focus();
  };

  const onRadioKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        ? -1
        : 0;
    if (!delta) return;
    e.preventDefault();
    const next =
      (index + delta + INSTALL_OPTIONS.length) % INSTALL_OPTIONS.length;
    setVariant(INSTALL_OPTIONS[next].key);
    radioRefs.current[next]?.focus();
  };

  const copy = useCallback(async () => {
    const context = copyContext.current;
    trackCtaClick({
      cta_id: 'hero_install',
      adapter: option.key,
      track: 'developer',
      surface: 'home',
    });
    try {
      if (!navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(option.command);
      observeInstallCopy(option.command);
      if (copyContext.current !== context) return;
      setCopied(true);
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(
        () => setCopied(false),
        COPY_FEEDBACK_MS
      );
    } catch {
      // Clipboard blocked: the command is visible, the user can select it.
    }
  }, [option]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      label={HERO_PRIMARY_LABEL}
      labelledBy={TITLE_ID}
      frameClassName="install-dialog"
    >
      <h2 id={TITLE_ID} className="install-dialog-title">
        {HERO_PRIMARY_LABEL}
      </h2>
      <p className="install-dialog-lede">Start with your framework.</p>
      <div
        role="tablist"
        aria-label="Framework"
        className="install-dialog-frameworks"
      >
        {(['angular', 'react'] as const).map((item, index) => (
          <button
            key={item}
            ref={(element) => {
              frameworkRefs.current[index] = element;
            }}
            id={`${panelId}-${item}`}
            type="button"
            role="tab"
            aria-selected={framework === item}
            aria-controls={panelId}
            tabIndex={framework === item ? 0 : -1}
            onClick={() => setFramework(item)}
            onKeyDown={(event) => onFrameworkKey(event, index)}
          >
            {item === 'angular' ? <AngularMark /> : <ReactMark />}
            {item === 'angular' ? 'Angular' : 'React'}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${panelId}-${framework}`}
      >
        {framework === 'angular' ? (
          <>
            <div className="install-dialog-step">
              <h3 className="install-dialog-step-title">
                Pick how you want to start
              </h3>
              <div
                role="radiogroup"
                aria-label="Starting point"
                className="install-dialog-seg"
              >
                {INSTALL_OPTIONS.map((o, i) => (
                  <button
                    key={o.key}
                    ref={(el) => {
                      radioRefs.current[i] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={o.key === variant}
                    tabIndex={o.key === variant ? 0 : -1}
                    className="install-dialog-seg-btn"
                    onClick={() => setVariant(o.key)}
                    onKeyDown={(e) => onRadioKey(e, i)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="install-dialog-step-note">{option.description}</p>
            </div>

            <div className="install-dialog-step">
              <h3 className="install-dialog-step-title">
                Run this in your Angular project
              </h3>
              {/* The command is one shell line, not code with meaningful line
              breaks — it wraps rather than scrolls, so the whole of it is
              visible at every width. Copy takes `option.command` from state,
              so the button still copies the single unwrapped string. */}
              <pre className="install-dialog-code install-dialog-command">
                <code data-testid="install-command">{option.command}</code>
              </pre>
              <p className="install-dialog-step-note">{option.peersNote}</p>
            </div>

            <details className="install-dialog-details">
              <summary>See Angular setup</summary>
              <p className="install-dialog-step-note">
                Add the provider and the component.
              </p>
              <pre className="install-dialog-code">
                <code data-testid="install-snippet">
                  {option.providerSnippet}
                </code>
              </pre>
              <pre className="install-dialog-code">
                <code data-testid="install-component">{componentSnippet}</code>
              </pre>
            </details>

            <div className="install-dialog-footer">
              <Button
                variant="ghost"
                size="lg"
                href={option.quickstartHref}
                onClick={() =>
                  trackCtaClick({
                    cta_id: 'hero_quickstart',
                    adapter: option.key,
                    track: 'developer',
                    surface: 'home',
                  })
                }
              >
                Open the full quickstart →
              </Button>
              <Button variant="primary" size="lg" onClick={copy}>
                {copied ? 'Copied ✓' : 'Copy install command'}
              </Button>
            </div>
            <p className="install-dialog-trust">{HERO_TRUST_LINE}</p>
          </>
        ) : (
          <>
            <div className="install-dialog-react">
              <h3>Build from source. Make it yours.</h3>
              <p>
                The React SDK is experimental. Its React, core, and content
                packages are not published to npm yet.
              </p>
              <p>
                The quickstart walks you through building and packing them from
                a repository checkout, then rendering your first conversation.
                No model key or backend needed.
              </p>
            </div>
            <div className="install-dialog-footer">
              <Button
                size="lg"
                href="/docs/react/getting-started/quickstart"
                onClick={() =>
                  trackCtaClick({
                    cta_id: 'hero_quickstart',
                    framework: 'react',
                    track: 'developer',
                    surface: 'home',
                  })
                }
              >
                Open the React quickstart →
              </Button>
              <Button variant="secondary" size="lg" href={GITHUB_REPO_URL}>
                Explore the source ↗
              </Button>
            </div>
            <p className="install-dialog-trust">
              MIT · your infrastructure · no account, no cloud
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
