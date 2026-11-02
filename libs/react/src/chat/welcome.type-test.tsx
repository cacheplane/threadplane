import type { ReactNode } from 'react';
import {
  Welcome,
  WelcomeSuggestion,
  type WelcomeProps,
  type WelcomeSuggestionProps,
} from './index';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
export type ExactWelcome = Assert<
  Equal<
    WelcomeProps,
    {
      readonly title?: ReactNode;
      readonly children?: ReactNode;
      readonly suggestions?: ReactNode;
      readonly className?: string;
    }
  >
>;
export type ExactSuggestion = Assert<
  Equal<
    WelcomeSuggestionProps,
    {
      readonly label: string;
      readonly value: string;
      readonly onSelect: (value: string) => void;
      readonly description?: string;
      readonly icon?: ReactNode;
      readonly disabled?: boolean;
      readonly className?: string;
    }
  >
>;
const welcome: WelcomeProps = { title: null, children: 0, suggestions: false };
const suggestion: WelcomeSuggestionProps = {
  label: 'Label',
  value: ' raw ',
  onSelect: (value) => {
    const raw: string = value;
    void raw;
  },
};
<Welcome />;
<Welcome
  {...welcome}
  title={<h3>Custom</h3>}
  suggestions={[<span key="a">A</span>]}
/>;
<WelcomeSuggestion
  {...suggestion}
  icon={<span>Icon</span>}
  description="Details"
  disabled={false}
  className="custom"
/>;
// @ts-expect-error All welcome props are readonly.
welcome.title = 'changed';
// @ts-expect-error Children are readonly.
welcome.children = null;
// @ts-expect-error Suggestions are readonly.
welcome.suggestions = null;
// @ts-expect-error Classes are readonly.
welcome.className = 'changed';
// @ts-expect-error Suggestion labels are readonly.
suggestion.label = 'changed';
// @ts-expect-error Values are readonly.
suggestion.value = 'changed';
// @ts-expect-error Callbacks are readonly.
suggestion.onSelect = () => undefined;
// @ts-expect-error Descriptions are readonly.
suggestion.description = 'changed';
// @ts-expect-error Icons are readonly.
suggestion.icon = null;
// @ts-expect-error Disabled is readonly.
suggestion.disabled = true;
// @ts-expect-error Classes are readonly.
suggestion.className = 'changed';
// @ts-expect-error Labels are required.
<WelcomeSuggestion value="raw" onSelect={() => undefined} />;
// @ts-expect-error Values are required.
<WelcomeSuggestion label="Label" onSelect={() => undefined} />;
// @ts-expect-error Callbacks are required.
<WelcomeSuggestion label="Label" value="raw" />;
// @ts-expect-error Labels are literal strings.
<WelcomeSuggestion {...suggestion} label={<b>Rich</b>} />;
// @ts-expect-error Values are strings.
<WelcomeSuggestion {...suggestion} value={1} />;
// @ts-expect-error Descriptions are literal strings.
<WelcomeSuggestion {...suggestion} description={<b>Rich</b>} />;
// @ts-expect-error Callback receives strings.
<WelcomeSuggestion {...suggestion} onSelect={(value: number) => void value} />;
// @ts-expect-error Disabled is boolean.
<WelcomeSuggestion {...suggestion} disabled="true" />;
// @ts-expect-error Classes are strings.
<Welcome className={1} />;
// @ts-expect-error Arbitrary objects are not content.
<Welcome title={{ arbitrary: true }} />;
