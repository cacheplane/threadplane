import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ChatSidenav,
  ChatSidenavScrim,
  type ChatSidenavMode,
} from '@threadplane/react/chat';

const narrowQuery = '(max-width: 700px)';

/** Responsive presentation belongs to this example, not the shared shell. */
export function NativeNavigation({
  selectedId,
  children,
  collapsedContent,
  onSearch,
}: {
  selectedId: string | null;
  children: ReactNode;
  collapsedContent?: ReactNode;
  onSearch?: () => void;
}) {
  const [desktopMode, setDesktopMode] =
    useState<Exclude<ChatSidenavMode, 'drawer'>>('expanded');
  const [narrow, setNarrow] = useState(
    () => window.matchMedia(narrowQuery).matches
  );
  const [open, setOpen] = useState(false);
  const [searchRequest, setSearchRequest] = useState(0);
  const pendingSearch = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const scrimFocused = useRef(false);
  const scrimOpen = narrow && open;

  useEffect(() => {
    const media = window.matchMedia(narrowQuery);
    const update = () => {
      setNarrow(media.matches);
      setOpen(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => setOpen(false), [selectedId]);

  useLayoutEffect(() => {
    if (!onSearch) {
      pendingSearch.current = false;
      return;
    }
    if (!pendingSearch.current || (narrow ? !open : desktopMode !== 'expanded'))
      return;
    pendingSearch.current = false;
    onSearch();
  }, [searchRequest, onSearch, narrow, open, desktopMode]);

  useLayoutEffect(() => {
    if (scrimOpen || !scrimFocused.current) return;
    scrimFocused.current = false;
    const document = root.current?.ownerDocument;
    if (document?.activeElement !== document?.body) return;
    root.current
      ?.querySelector<HTMLButtonElement>(
        narrow ? '.tp-chat-sidenav__launcher' : '.tp-chat-sidenav__toggle'
      )
      ?.focus();
  }, [scrimOpen, narrow]);

  return (
    <div
      ref={root}
      onFocusCapture={(event) => {
        scrimFocused.current = event.target.classList.contains(
          'tp-chat-sidenav-scrim'
        );
      }}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          scrimFocused.current = false;
        }
      }}
    >
      <ChatSidenavScrim open={scrimOpen} onDismiss={() => setOpen(false)} />
      <ChatSidenav
        toggleShortcut
        mode={narrow ? 'drawer' : desktopMode}
        open={open}
        onOpenChange={setOpen}
        onModeChange={setDesktopMode}
        className="native-conversation-sidenav"
        collapsedContent={collapsedContent}
        onSearch={
          onSearch
            ? () => {
                pendingSearch.current = true;
                if (narrow) setOpen(true);
                else setDesktopMode('expanded');
                setSearchRequest((request) => request + 1);
              }
            : undefined
        }
        searchLabel="Search loaded conversations"
        searchShortcut
      >
        {children}
      </ChatSidenav>
    </div>
  );
}
