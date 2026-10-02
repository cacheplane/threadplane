import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToolViewsDemo } from './app';
import type { WeatherReading } from './tool-view-policy';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  snapshot: undefined as unknown,
}));
vi.mock('./connection', () => ({ createConnectedApplication: mocks.create }));
vi.mock('@threadplane/react', () => ({ useAgent: () => mocks.snapshot }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const reading: WeatherReading = {
  location: 'San Francisco',
  temperatureF: 68,
  conditions: 'Sunny',
  humidity: 55,
  windMph: 8,
};
function fixture(views: unknown[] = [], update = {}) {
  mocks.snapshot = {
    views,
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration: 0,
    ...update,
  };
  const application = {
    getSnapshot: () => mocks.snapshot,
    submit: vi.fn(),
    newConversation: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
  mocks.create.mockReturnValue(application);
  const ready = vi.fn();
  const rendered = render(
    <ToolViewsDemo
      connection={{ url: 'PRIVATE_ENDPOINT', label: 'Shared runtime' }}
      onReady={ready}
    />
  );
  return { application, ready, rendered };
}
it('shows lazy ready native input and keeps the endpoint out of the visible UI', () => {
  const { application, ready } = fixture();
  expect(ready).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toBe('Ready.');
  expect(
    screen.getByRole('region', { name: 'Runtime connection' }).textContent
  ).toContain('Shared runtime');
  expect(screen.queryByText('PRIVATE_ENDPOINT')).toBeNull();
  expect(application.submit).not.toHaveBeenCalled();
});
it('keeps native literal text, tool observation and weather data with their assistant owner', () => {
  const text = '<img src=x onerror=alert(1)> **literal**';
  fixture([
    {
      id: 'human',
      text: { id: 'human', role: 'user', content: text },
      tools: [],
    },
    {
      id: 'owner',
      tools: [
        {
          id: 'call',
          name: 'weather_card',
          argumentsText: '{"location":"San Francisco"}',
          resultText: JSON.stringify(reading),
          weather: reading,
        },
      ],
    },
    {
      id: 'answer',
      text: { id: 'answer', role: 'assistant', content: 'Ready.' },
      tools: [],
    },
  ]);
  const conversation = screen.getByRole('region', { name: 'Conversation' });
  expect(within(conversation).getByText(text)).toBeTruthy();
  expect(conversation.querySelectorAll('img')).toHaveLength(0);
  const owner = conversation.querySelector('[data-weather-message="owner"]')!;
  expect(
    within(owner as HTMLElement).getByRole('heading', {
      name: 'Weather for San Francisco',
    })
  ).toBeTruthy();
  expect(owner.textContent).toContain('68');
  expect(owner.textContent).toContain('Sunny');
  expect(owner.querySelector('[aria-label="Tool observation"]')).toBeTruthy();
  expect(conversation.querySelectorAll('[data-weather-message]')).toHaveLength(
    3
  );
});
it('partial arguments stay pending and do not display an invented reading', () => {
  fixture(
    [
      {
        id: 'owner',
        tools: [
          { id: 'call', name: 'weather_card', argumentsText: '{"location":' },
        ],
      },
    ],
    { busy: true, canSubmit: false }
  );
  expect(screen.getByText('Waiting for weather data…')).toBeTruthy();
  expect(screen.queryByText('Sunny')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe(
    'Getting a weather reading…'
  );
});
it('New and unmount delegate lifetime to the application', () => {
  const { application, rendered } = fixture();
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  expect(application.newConversation).toHaveBeenCalledTimes(1);
  rendered.unmount();
  expect(application.dispose).toHaveBeenCalledTimes(1);
});
it('uncertain results require New and disable another Send', () => {
  fixture([], {
    canSubmit: false,
    error: 'The reading could not be confirmed.',
  });
  expect(screen.getByRole('status').textContent).toBe(
    'Start a new conversation to continue.'
  );
  expect(
    screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')
  ).toBe(true);
  expect(screen.getByRole('alert').textContent).toBe(
    'The reading could not be confirmed.'
  );
});
