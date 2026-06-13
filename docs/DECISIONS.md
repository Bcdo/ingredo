# Technical Decisions

This document records important project decisions.

Use this format:

```text
## YYYY-MM-DD - Decision Title

Decision:
...

Reason:
...

Alternatives considered:
...

Consequences:
...
```

## 2026-06-11 - Use Expo Instead of Nuxt + Capacitor

Decision:

Use Expo for the mobile application.

Reason:

The app is intended primarily for iOS and Android. Time to ship is not the highest priority, and the project is also meant for learning mobile development.

Alternatives considered:

- Nuxt + Capacitor
- React Native without Expo

Consequences:

- Need to learn React Native patterns
- Better mobile-first foundation
- Better training value
- No web target initially

## 2026-06-11 - Use ASP.NET Core + EF Core Instead of Supabase

Decision:

Use a custom ASP.NET Core backend with Entity Framework Core.

Reason:

The project is also intended as backend/API training. Building the backend provides practice with API design, authentication, authorization, EF relationships, migrations, sync logic, and deployment.

Alternatives considered:

- Supabase
- Firebase

Consequences:

- More backend work
- More control over architecture
- Better training value
- Slower initial development

## 2026-06-11 - Use a Monorepo

Decision:

Use one repository with frontend and backend folders.

Reason:

The frontend and backend are tightly related. Many features will require changes to the mobile app, API, and database model together.

Alternatives considered:

- Separate frontend and backend repositories

Consequences:

- Easier issue/PR tracking
- Easier cross-stack changes
- Slightly more need for folder discipline
