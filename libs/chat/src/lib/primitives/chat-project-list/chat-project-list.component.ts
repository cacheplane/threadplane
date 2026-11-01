// libs/chat/src/lib/primitives/chat-project-list/chat-project-list.component.ts
import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_PROJECT_LIST_STYLES } from '../../styles/chat-project-list.styles';
import {
  ChatOverflowMenuComponent,
  type OverflowMenuItem,
} from '../chat-overflow-menu/chat-overflow-menu.component';
import { ChatConfirmDialogComponent } from '../chat-confirm-dialog/chat-confirm-dialog.component';

/** A selectable project identified by its id and display name, with optional consumer metadata. */
export type Project = {
  id: string;
  name: string;
  /** Open shape — consumers may add icon, color, createdAt, etc. */
  [key: string]: unknown;
};

/**
 * Consumer-provided adapter for project lifecycle actions. The framework calls
 * these methods after user confirmation (delete) or commit (create/rename) and
 * manages optimistic UI + rollback on rejection.
 */
export interface ProjectActionAdapter {
  /** Create a new project. Returns the new project id; consumer is expected
   *  to also refresh its projects signal. */
  create?(name: string): Promise<{ id: string }>;
  rename?(projectId: string, newName: string): Promise<void>;
  /** Permanently delete the project. The framework calls this AFTER user
   *  confirms via the confirm dialog. */
  delete?(projectId: string): Promise<void>;
}

/** Lists selectable projects with optional creation, rename, and confirmed deletion actions. */
@Component({
  selector: 'chat-project-list',
  standalone: true,
  imports: [ChatOverflowMenuComponent, ChatConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_PROJECT_LIST_STYLES],
  template: `
    @if (showNewProjectButton()) {
      <button type="button" class="chat-project-list__new" (click)="onNewProjectClicked()">+ New project</button>
    }
    <ul class="chat-project-list">
      @if (creatingProject()) {
        <li class="chat-project-list__item-wrap">
          <input
            #createInput
            class="chat-project-list__edit"
            type="text"
            placeholder="New project name"
            [value]="creatingValue()"
            (input)="onCreateInput($event)"
            (keydown.enter)="commitCreate()"
            (keydown.escape)="cancelCreate()"
            (blur)="cancelCreate()"
            aria-label="New project name"
          />
        </li>
      }
      @for (project of visibleProjects(); track project.id) {
        <li class="chat-project-list__item-wrap">
          @if (editingProjectId() === project.id) {
            <input
              #editInput
              class="chat-project-list__edit"
              type="text"
              [value]="editingValue()"
              (input)="onEditInput($event)"
              (keydown.enter)="commitRename(project.id)"
              (keydown.escape)="cancelRename()"
              (blur)="cancelRename()"
              aria-label="Rename project"
            />
          } @else {
            <button
              type="button"
              class="chat-project-list__item"
              [attr.data-active]="project.id === activeProjectId() ? 'true' : null"
              [attr.aria-current]="project.id === activeProjectId() ? 'true' : null"
              (click)="selectProject(project.id)"
            >{{ project.name }}</button>

            @if (showKebab()) {
              <button
                #kebab
                type="button"
                class="chat-project-list__kebab"
                aria-label="More actions"
                aria-haspopup="menu"
                [attr.aria-expanded]="menuOpenForId() === project.id ? 'true' : 'false'"
                (click)="openMenu(project.id, kebab)"
              >⋯</button>
            }
          }
        </li>
      }
    </ul>

    <chat-overflow-menu
      [open]="menuOpenForId() !== null"
      [items]="currentMenuItems()"
      [anchor]="menuAnchor()"
      (itemSelected)="onMenuAction($event)"
      (closed)="menuOpenForId.set(null)"
    />

    <chat-confirm-dialog
      [open]="confirmDeleteId() !== null"
      title="Delete project?"
      body="The project will be deleted. Threads in this project will remain but become unassigned."
      confirmLabel="Delete"
      tone="destructive"
      (confirmed)="performDelete()"
      (cancelled)="confirmDeleteId.set(null)"
    />
  `,
})
export class ChatProjectListComponent {
  readonly projects = input.required<Project[]>();
  readonly activeProjectId = input<string | null>(null);
  readonly showNewProjectButton = input<boolean>(false);
  readonly actions = input<ProjectActionAdapter | null>(null);

  readonly projectSelected = output<string>();
  readonly newProjectRequested = output<void>();

  protected readonly creatingProject = signal<boolean>(false);
  protected readonly creatingValue = signal<string>('');
  protected readonly editingProjectId = signal<string | null>(null);
  protected readonly editingValue = signal<string>('');
  protected readonly menuOpenForId = signal<string | null>(null);
  protected readonly menuAnchor = signal<HTMLElement | null>(null);
  protected readonly confirmDeleteId = signal<string | null>(null);

  private readonly pendingHidden = signal<ReadonlySet<string>>(new Set());
  private readonly pendingRenames = signal<ReadonlyMap<string, string>>(new Map());

  protected readonly visibleProjects = computed<Project[]>(() => {
    const hidden = this.pendingHidden();
    const renames = this.pendingRenames();
    return this.projects()
      .filter((p) => !hidden.has(p.id))
      .map((p) => (renames.has(p.id) ? ({ ...p, name: renames.get(p.id)! }) : p));
  });

  protected readonly currentMenuItems = computed<OverflowMenuItem[]>(() => {
    const id = this.menuOpenForId();
    if (!id) return [];
    const a = this.actions();
    if (!a) return [];
    const items: OverflowMenuItem[] = [];
    if (a.rename) items.push({ id: 'rename', label: 'Rename' });
    if (a.delete) items.push({ id: 'delete', label: 'Delete', tone: 'destructive' });
    return items;
  });

  private readonly createInput = viewChild<ElementRef<HTMLInputElement>>('createInput');
  private readonly editInput = viewChild<ElementRef<HTMLInputElement>>('editInput');

  constructor() {
    effect(() => {
      if (this.creatingProject()) {
        queueMicrotask(() => this.createInput()?.nativeElement.focus());
      }
    });
  }

  protected selectProject(projectId: string): void {
    this.projectSelected.emit(projectId);
  }

  protected showKebab(): boolean {
    const a = this.actions();
    if (!a) return false;
    return Boolean(a.rename || a.delete);
  }

  protected openMenu(projectId: string, anchor: HTMLElement): void {
    this.menuAnchor.set(anchor);
    this.menuOpenForId.set(projectId);
  }

  protected onMenuAction(id: string): void {
    const projectId = this.menuOpenForId();
    this.menuOpenForId.set(null);
    if (!projectId) return;

    if (id === 'rename') {
      const p = this.projects().find((x) => x.id === projectId);
      this.editingValue.set(p?.name ?? '');
      this.editingProjectId.set(projectId);
      queueMicrotask(() => this.editInput()?.nativeElement.focus());
    } else if (id === 'delete') {
      this.confirmDeleteId.set(projectId);
    }
  }

  protected onNewProjectClicked(): void {
    this.creatingValue.set('');
    this.creatingProject.set(true);
    this.newProjectRequested.emit();
  }

  protected onCreateInput(e: Event): void {
    this.creatingValue.set((e.target as HTMLInputElement).value);
  }

  protected cancelCreate(): void {
    this.creatingProject.set(false);
    this.creatingValue.set('');
  }

  protected async commitCreate(): Promise<void> {
    const name = this.creatingValue().trim();
    this.creatingProject.set(false);
    this.creatingValue.set('');
    if (!name) return;
    const a = this.actions();
    if (!a?.create) return;
    try { await a.create(name); } catch { /* consumer's refresh won't show the row */ }
  }

  protected onEditInput(e: Event): void {
    this.editingValue.set((e.target as HTMLInputElement).value);
  }

  protected cancelRename(): void {
    this.editingProjectId.set(null);
  }

  protected async commitRename(projectId: string): Promise<void> {
    const newName = this.editingValue().trim();
    this.editingProjectId.set(null);
    if (!newName) return;
    const a = this.actions();
    if (!a?.rename) return;

    this.pendingRenames.update((m) => {
      const n = new Map(m);
      n.set(projectId, newName);
      return n;
    });
    try {
      await a.rename(projectId, newName);
    } catch {
      /* rollback via finally */
    } finally {
      this.pendingRenames.update((m) => {
        const n = new Map(m);
        n.delete(projectId);
        return n;
      });
    }
  }

  protected async performDelete(): Promise<void> {
    const projectId = this.confirmDeleteId();
    this.confirmDeleteId.set(null);
    if (!projectId) return;
    const a = this.actions();
    if (!a?.delete) return;

    this.pendingHidden.update((s) => new Set([...s, projectId]));
    try {
      await a.delete(projectId);
    } catch {
      /* rollback */
    } finally {
      this.pendingHidden.update((s) => {
        const n = new Set(s);
        n.delete(projectId);
        return n;
      });
    }
  }
}
