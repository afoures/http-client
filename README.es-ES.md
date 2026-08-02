

# http-client

Un cliente HTTP con tipado seguro y robusto, con validación de esquemas.

## ¿Por qué?

**Tipado seguro por diseño**: Los parámetros de ruta, cadenas de consulta, cuerpos de solicitud y respuestas están todos tipados. Las respuestas están tipadas _por código de estado_ (con valores de respaldo para comodines `2xx`/`4xx`/`5xx`), por lo que el cuerpo de un `200` y el de un `404` tienen su propio tipo. La validación de esquemas ocurre en tiempo de ejecución con inferencia completa de TypeScript.

**Compatible con Standard Schema**: Funciona con Zod, ArkType, Valibot o cualquier biblioteca de esquemas que implemente la [especificación Standard Schema](https://github.com/standard-schema/standard-schema).

**Manejo de errores robusto**: Errores tipados para tiempos de espera, fallos de red, problemas de serialización y errores inesperados. Ya no tendrás que adivinar qué salió mal.

**Reintento integrado**: Políticas de reintento configurables con condiciones contextuales y soporte para *backoff* exponencial.

## Instalación

```bash
npm install @afoures/http-client
# or
pnpm add @afoures/http-client
# or
yarn add @afoures/http-client
# or
bun add @afoures/http-client
```

```typescript
import { Endpoint, http_client } from "@afoures/http-client";
import { z } from "zod";

const api = http_client(
  {
    users: {
      list: new Endpoint({
        method: "GET",
        pathname: "/users",
        query: {
          schema: z.object({
            page: z
              .number()
              .transform((n) => String(n))
              .optional(),
            limit: z
              .number()
              .transform((n) => String(n))
              .optional(),
          }),
        },
        responses: {
          200: {
            schema: z.array(z.object({ id: z.string(), name: z.string() })),
            parse: "json",
          },
        },
      }),
      get: new Endpoint({
        method: "GET",
        pathname: "/users/:id",
        responses: {
          200: {
            schema: z.object({ id: z.string(), name: z.string() }),
            parse: "json",
          },
          404: {
            schema: z.object({ message: z.string() }),
            parse: "json",
          },
        },
      }),
      create: new Endpoint({
        method: "POST",
        pathname: "/users",
        body: {
          schema: z.object({ name: z.string(), email: z.string().email() }),
          serialize: "json",
        },
        responses: {
          201: {
            schema: z.object({ id: z.string(), name: z.string() }),
            parse: "json",
          },
        },
      }),
    },
  },
  { base_url: "https://api.example.com" },
);

// All endpoints are fully typed
const list = await api.users.list({ query: { page: 1, limit: 10 } });
const user = await api.users.get({ params: { id: "123" } });
const created = await api.users.create({ body: { name: "John", email: "john@example.com" } });
```

## Documentación

- [Cliente HTTP](./docs/http-client.md)
- [Definición de Endpoint](./docs/endpoint-definition.md)
- [Contexto Dinámico](./docs/dynamic-context.md)
- [Integración de Esquemas](./docs/schema-integration.md)
- [Serialización](./docs/serialization.md)
- [Parseo de Respuestas](./docs/response-parsing.md)
- [Manejo de Errores](./docs/error-handling.md)
- [Política de Reintento](./docs/retry-policy.md)

## Licencia

MIT
