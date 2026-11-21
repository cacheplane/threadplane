import { Component, input } from '@angular/core';
import { z } from 'zod/v4';
import type {
  ClientToolDef,
  ClientToolLifecycle,
  ClientToolViewProps,
  ViewToolDef,
} from './tool-def';
import type { ToolCallStatus } from '../agent';
import { view, ask, tools } from './tools';

@Component({ template: '' })
class DayCardComponent {
  day = input.required<number>();
  places = input<string[]>([]);       // optional (default)
  highlight = input<boolean>(false);  // extra input NOT in schema
}

@Component({ template: '' })
class UnrelatedComponent {
  title = input.required<string>();
}

const daySchema = z.object({ day: z.number(), places: z.array(z.string()) });

// ✅ good — schema output keys ⊆ inputs, compatible types; extra `highlight` allowed.
const dayView = view('Show a day', daySchema, DayCardComponent);

// the view tool stays assignable to the registry union and through tools().
const _u: ClientToolDef = dayView;
const _reg = tools({ day_card: view('Show a day', daySchema, DayCardComponent) });

// the result carries the component type.
const _carries: ViewToolDef<typeof daySchema, DayCardComponent> = dayView;

type DayClientToolViewProps = ClientToolViewProps<typeof daySchema>;
const _status: ToolCallStatus | undefined = ({} as DayClientToolViewProps).status;
const _clientTool: ClientToolLifecycle | undefined = ({} as DayClientToolViewProps).clientTool;

// ❌ typo prop the component can't receive.
const typoSchema = z.object({ dayz: z.number() });
// @ts-expect-error  `dayz` is not an input of DayCardComponent
const _bad1 = view('typo', typoSchema, DayCardComponent);

// ❌ type mismatch (day: string vs input number).
const wrongType = z.object({ day: z.string() });
// @ts-expect-error  day: string not assignable to input day: number
const _bad2 = view('wrong type', wrongType, DayCardComponent);

// ❌ unrelated component.
// @ts-expect-error  schema output {day, places} has no matching inputs on UnrelatedComponent
const _bad3 = ask('unrelated', daySchema, UnrelatedComponent);
