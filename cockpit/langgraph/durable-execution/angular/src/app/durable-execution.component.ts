import { Component, computed } from '@angular/core';
import { ChatComponent, views } from '@threadplane/chat';
import { injectAgent } from '@threadplane/langgraph';
import { signalStateStore } from '@threadplane/render';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { StepPipelineComponent } from './views/step-pipeline.component';

// #region steps-model
/**
 * Pipeline step definition for the vertical progress indicator.
 */
interface PipelineStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'complete';
}

/** Ordered node names emitted by the Python graph's `state.step` field. */
const STEP_ORDER = ['analyze', 'plan', 'generate'] as const;

/** Human-readable labels for each pipeline step. */
const STEP_LABELS: Record<string, string> = {
  analyze: 'Analyze',
  plan: 'Plan',
  generate: 'Generate',
};
// #endregion

/**
 * DurableExecutionComponent demonstrates fault-tolerant multi-step execution
 * with `injectAgent()`.
 *
 * This example shows how a graph checkpoints at each node, enabling it to
 * resume after failures. The backend processes each request through three
 * nodes: analyze, plan, generate. Each node updates `state.step` so the
 * UI can track progress via a vertical step indicator in the sidebar.
 */
@Component({
  selector: 'app-durable-execution',
  standalone: true,
  imports: [ChatComponent, ExampleChatLayoutComponent],
  styles: `
    :host {
      --st-done: #2ea567;
      --st-active: #e0a850;
      --st-error: #e0645a;
    }
    .panel {
      padding: 1rem;
      background: var(--ds-surface, #1c1c1c);
      color: var(--ds-text-primary, #f5f5f5);
      height: 100%;
    }
    .cap {
      margin-bottom: 1.5rem;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--ds-text-muted, #a0a0a0);
    }
    .steps {
      display: flex;
      flex-direction: column;
    }
    .step {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
    }
    .step__col {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .circle {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .circle--complete {
      background: var(--st-done);
    }
    .circle--complete svg {
      width: 16px;
      height: 16px;
      color: #fff;
    }
    .circle--active {
      border: 2px solid var(--st-active);
      animation: dx-spin 1.2s linear infinite;
    }
    .circle--pending {
      border: 2px solid var(--ds-border, #2d2d2d);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
    }
    .dot--active {
      background: var(--st-active);
    }
    .dot--pending {
      background: var(--ds-text-muted, #a0a0a0);
    }
    @keyframes dx-spin {
      to {
        transform: rotate(360deg);
      }
    }
    .line {
      width: 2px;
      height: 2rem;
    }
    .line--done {
      background: var(--st-done);
    }
    .line--pending {
      background: var(--ds-border, #2d2d2d);
    }
    .label {
      font-size: 13px;
      padding-top: 4px;
    }
    .label--active {
      font-weight: 600;
      color: var(--st-active);
    }
    .label--complete {
      color: var(--st-done);
    }
    .label--pending {
      color: var(--ds-text-muted, #a0a0a0);
    }
  `,
  template: `
    <example-chat-layout sidebarWidth="18rem"
      title="LangGraph durable execution"
      description="Follow a request through Analyze, Plan and Generate. Each completed node saves a checkpoint on the server."
    >
      <!-- #region layout -->
      <chat placeholder="Plan a fictional project…" [welcomeDisabled]="true" main [agent]="agent" [views]="ui" [store]="uiStore" class="flex-1 min-w-0">
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.isLoading() ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
      </chat>
      <div sidebar class="panel">
        <h3 class="cap">Pipeline</h3>

        <div class="steps">
          @for (step of steps(); track step.id; let last = $last) {
            <div class="step">
              <!-- Step indicator column -->
              <div class="step__col">
                <!-- Circle / icon -->
                @switch (step.status) {
                  @case ('complete') {
                    <div class="circle circle--complete">
                      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  }
                  @case ('active') {
                    <div class="circle circle--active">
                      <div class="dot dot--active"></div>
                    </div>
                  }
                  @default {
                    <div class="circle circle--pending">
                      <div class="dot dot--pending"></div>
                    </div>
                  }
                }
                <!-- Connecting line -->
                @if (!last) {
                  <div class="line" [class.line--done]="step.status === 'complete'" [class.line--pending]="step.status !== 'complete'"></div>
                }
              </div>

              <!-- Label -->
              <span
                class="label"
                [class.label--active]="step.status === 'active'"
                [class.label--complete]="step.status === 'complete'"
                [class.label--pending]="step.status === 'pending'"
              >
                {{ step.label }}
              </span>
            </div>
          }
        </div>
      </div>
      <!-- #endregion -->
    </example-chat-layout>
  `,
})
export class DurableExecutionComponent {
  readonly ui = views({ 'step-pipeline': StepPipelineComponent });
  readonly uiStore = signalStateStore({});

  // #region agent
  protected readonly agent = injectAgent();

  /**
   * Derives the 3-step pipeline status from the graph's `state.step` field.
   *
   * Steps before the current one are marked complete, the current step is
   * active, and subsequent steps remain pending.
   */
  protected readonly steps = computed<PipelineStep[]>(() => {
    const val = this.agent.value() as Record<string, unknown> | undefined;
    const currentStep = (val?.['step'] as string) ?? '';
    const activeIndex = STEP_ORDER.indexOf(currentStep as (typeof STEP_ORDER)[number]);

    return STEP_ORDER.map((id, i) => ({
      id,
      label: STEP_LABELS[id],
      status: activeIndex < 0 ? 'pending' : i < activeIndex ? 'complete' : i === activeIndex ? 'active' : 'pending',
    }));
  });
  // #endregion
}
