import { Injectable, signal } from '@angular/core';
import type { Project } from '@threadplane/angular/chat/threads';

const STORAGE_KEY = 'threadplane-example-projects-v1';

@Injectable({ providedIn: 'root' })
export class ProjectsService {
  readonly projects = signal<Project[]>(this.load());

  async create(name: string): Promise<{ id: string }> {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.projects.update((p) => [{ id, name }, ...p]);
    this.save(this.projects());
    return { id };
  }

  async rename(id: string, name: string): Promise<void> {
    this.projects.update((p) => p.map((x) => x.id === id ? { ...x, name } : x));
    this.save(this.projects());
  }

  async delete(id: string): Promise<void> {
    this.projects.update((p) => p.filter((x) => x.id !== id));
    this.save(this.projects());
  }

  private load(): Project[] {
    if (typeof localStorage === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
  }

  private save(p: Project[]): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  }
}
