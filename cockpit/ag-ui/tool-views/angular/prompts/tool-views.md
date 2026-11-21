# AG-UI Tool Views (Angular)

This capability demonstrates rendering frontend-owned Angular components for agent tool calls using the `@threadplane/angular/chat` `views` registry. When the agent invokes the `weather_card` tool, the registered `WeatherCardComponent` renders inline in the chat transcript — live from the tool call's streamed arguments and final result — without any UI specification sent from the backend.

Key API: `views({ weather_card: WeatherCardComponent })` builds a `ViewRegistry` that maps tool names to Angular components. The `[views]` input on `<chat>` activates the registry; matched tool calls bypass the default tool-call display and render the registered component instead. The component receives `status` ('running' | 'complete'), the tool call's partial `args` while streaming, and the merged result fields on completion.

The `WeatherCardComponent` uses Angular signal inputs (`location`, `temperatureF`, `conditions`, `humidity`, `windMph`, `status`) and a `pending` computed signal to show a loading affordance until the result arrives. This pattern extends to any tool — register any standalone Angular component under the tool name key.
