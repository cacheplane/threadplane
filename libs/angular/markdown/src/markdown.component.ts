import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  markdownUrl,
  type MarkdownNode,
  type MarkdownSnapshot,
} from '@threadplane/content/markdown';
import { MarkdownImageComponent } from './markdown-image.component';
import {
  MarkdownNodesDirective,
  MarkdownOutletDirective,
} from './markdown-template.directive';

@Component({
  selector: 'threadplane-markdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MarkdownNodesDirective,
    MarkdownOutletDirective,
    MarkdownImageComponent,
  ],
  template: `
    @for (document of [snapshot().document]; track document.generation) {
    @if (snapshot().root; as root) {
    <ng-container
      [markdownOutlet]="nodesView"
      [markdownContext]="{
        $implicit: root.children,
        root,
        anchor: false,
        header: false
      }"
    />
    } }
    <ng-template
      #nodesView
      markdownNodes
      let-nodes
      let-root="root"
      let-anchor="anchor"
      let-header="header"
    >
      @for (node of nodes; track node.type + ':' + node.id) { @switch
      (node.type) { @case ('document') {
      <ng-container
        [markdownOutlet]="nodesView"
        [markdownContext]="{
          $implicit: node.children,
          root: node,
          anchor,
          header
        }"
      />
      } @case ('paragraph') {
      <p>
        <ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{ $implicit: node.children, root, anchor, header }"
        />
      </p>
      } @case ('heading') { @switch (node.level) { @case (1) {
      <h1>
        <ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{ $implicit: node.children, root, anchor, header }"
        />
      </h1>
      } @case (2) {
      <h2>
        <ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{ $implicit: node.children, root, anchor, header }"
        />
      </h2>
      } @case (3) {
      <h3>
        <ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{ $implicit: node.children, root, anchor, header }"
        />
      </h3>
      } @case (4) {
      <h4>
        <ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{ $implicit: node.children, root, anchor, header }"
        />
      </h4>
      } @case (5) {
      <h5>
        <ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{ $implicit: node.children, root, anchor, header }"
        />
      </h5>
      } @case (6) {
      <h6>
        <ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{ $implicit: node.children, root, anchor, header }"
        />
      </h6>
      } } } @case ('blockquote') {
      <blockquote>
        <ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{ $implicit: node.children, root, anchor, header }"
        />
      </blockquote>
      } @case ('list') { @if (node.ordered) {
      <ol [attr.start]="node.start">
        <ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{ $implicit: node.children, root, anchor, header }"
        />
      </ol>
      } @else {
      <ul>
        <ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{ $implicit: node.children, root, anchor, header }"
        />
      </ul>
      } } @case ('list-item') {
      <li>
        @if (node.task; as task) {
        <input
          type="checkbox"
          disabled
          [checked]="task.checked"
          [attr.aria-label]="task.checked ? 'Completed task' : 'Incomplete task'"
        />
        }
        <ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{ $implicit: node.children, root, anchor, header }"
        />
      </li>
      } @case ('code-block') {
      <pre><code>{{ node.text }}</code></pre>
      } @case ('thematic-break') {
      <hr />
      } @case ('text') {<ng-container>{{ node.text }}</ng-container
      >} @case ('emphasis') {
      <em
        ><ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{
            $implicit: node.children,
            root,
            anchor,
            header
          }"
      /></em>
      } @case ('strong') {
      <strong
        ><ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{
            $implicit: node.children,
            root,
            anchor,
            header
          }"
      /></strong>
      } @case ('strikethrough') {
      <del
        ><ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{
            $implicit: node.children,
            root,
            anchor,
            header
          }"
      /></del>
      } @case ('inline-code') { <code class="inline-code">{{ node.text }}</code> } @case ('link') {
      @if (!anchor && url(node.url, 'link'); as destination) {
      <a [href]="destination" [title]="node.title"
        ><ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{
            $implicit: node.children,
            root,
            anchor: true,
            header
          }"
      /></a>
      } @else {
      <ng-container
        [markdownOutlet]="nodesView"
        [markdownContext]="{ $implicit: node.children, root, anchor, header }"
      />
      } } @case ('autolink') { @if (!anchor && url(node.url, 'link'); as
      destination) { <a [href]="destination">{{ node.text }}</a> } @else
      {<ng-container>{{ node.text }}</ng-container
      >} } @case ('link-reference') { @if (node.resolved) { @if (!anchor &&
      url(node.url, 'link'); as destination) {
      <a [href]="destination" [title]="node.title"
        ><ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{
            $implicit: node.children,
            root,
            anchor: true,
            header
          }"
      /></a>
      } @else {
      <ng-container
        [markdownOutlet]="nodesView"
        [markdownContext]="{ $implicit: node.children, root, anchor, header }"
      />
      } } @else {<ng-container>[</ng-container
      ><ng-container
        [markdownOutlet]="nodesView"
        [markdownContext]="{ $implicit: node.children, root, anchor, header }"
      /><ng-container>{{ ']' + referenceSuffix(node) }}</ng-container
      >} } @case ('image') { @for (image of [node]; track image.url)
      { <threadplane-markdown-image [image]="image" /> } } @case ('soft-break')
      {<ng-container>{{ '\\n' }}</ng-container
      >} @case ('hard-break') { <br />
      } @case ('table') {
      <table>
        <thead>
          <ng-container
            [markdownOutlet]="nodesView"
            [markdownContext]="{
              $implicit: tableRows(node, true),
              root,
              anchor,
              header: true
            }"
          />
        </thead>
        <tbody>
          <ng-container
            [markdownOutlet]="nodesView"
            [markdownContext]="{
              $implicit: tableRows(node, false),
              root,
              anchor,
              header: false
            }"
          />
        </tbody>
      </table>
      } @case ('table-row') {
      <tr>
        <ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{
            $implicit: node.children,
            root,
            anchor,
            header: node.isHeader
          }"
        />
      </tr>
      } @case ('table-cell') { @if (header) {
      <th [style.text-align]="node.alignment">
        <ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{ $implicit: node.children, root, anchor, header }"
        />
      </th>
      } @else {
      <td [style.text-align]="node.alignment">
        <ng-container
          [markdownOutlet]="nodesView"
          [markdownContext]="{ $implicit: node.children, root, anchor, header }"
        />
      </td>
      } } @case ('citation-reference') { @if (root.citations.get(node.refId); as
      citation) {
      <sup [attr.aria-label]="'Citation ' + citation.index">{{
        '[' + citation.index + ']'
      }}</sup>
      } @else {
      <sup [attr.aria-label]="'Unresolved citation ' + node.refId">{{
        '[^' + node.refId + ']'
      }}</sup>
      } } @case ('math-inline') {<ng-container>{{
        mathSource(node)
      }}</ng-container
      >} @case ('math-display') {
      <pre>{{ mathSource(node) }}</pre>
      } @case ('html-inline') {<ng-container>{{ node.raw }}</ng-container
      >} @case ('html-block') {
      <pre>{{ node.raw }}</pre>
      } } }
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
      color: var(--ds-text-primary, #142435);
      font-family: inherit;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    .inline-code { white-space: pre-wrap; }
  `,
})
export class MarkdownComponent {
  readonly snapshot = input.required<MarkdownSnapshot>();
  protected readonly url = markdownUrl;
  protected tableRows(
    node: Extract<MarkdownNode, { type: 'table' }>,
    header: boolean
  ): readonly MarkdownNode[] {
    return node.children.filter((row) => row.isHeader === header);
  }
  protected referenceSuffix(
    node: Extract<MarkdownNode, { type: 'link-reference' }>
  ): string {
    return node.form === 'full'
      ? '[' + node.label + ']'
      : node.form === 'collapsed'
      ? '[]'
      : '';
  }
  protected mathSource(
    node: Extract<MarkdownNode, { type: 'math-inline' | 'math-display' }>
  ) {
    if (node.type === 'math-inline')
      return node.delimiter === '$'
        ? '$' + node.text + '$'
        : '\\(' + node.text + '\\)';
    return node.delimiter === '$$'
      ? '$$\n' + node.text + '\n$$'
      : '\\[' + node.text + '\\]';
  }
}
