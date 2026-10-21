import { useEffect, useState, type ReactNode } from 'react';
import { ChatSidenav, type ChatSidenavMode } from '@threadplane/react/chat';

const narrowQuery = '(max-width: 700px)';

/** Responsive presentation belongs to this example, not the shared shell. */
export function NativeNavigation({
  selectedId,
  children,
}: {
  selectedId: string | null;
  children: ReactNode;
}) {
  const [desktopMode, setDesktopMode] =
    useState<Exclude<ChatSidenavMode, 'drawer'>>('expanded');
  const [narrow, setNarrow] = useState(
    () => window.matchMedia(narrowQuery).matches
  );
  const [open, setOpen] = useState(false);

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

  return (
    <ChatSidenav
      mode={narrow ? 'drawer' : desktopMode}
      open={open}
      onOpenChange={setOpen}
      onModeChange={setDesktopMode}
      className="native-conversation-sidenav"
    >
      {children}
    </ChatSidenav>
  );
}
