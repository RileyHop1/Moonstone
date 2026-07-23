# Abstract Goal

Your goal is to create the front end for the moonstone latex editor, before we begin make sure you familiarize yourself with the entire codebase leave no stone unturned. That includes reading the existing docs and ideas, but if anything there contradicts what I say here, take this over it.
There is really 3 pages that need to exist right now in moonstone a project browser page, a project page and settings page. I'll break down each bellow.

## Project browser

This is the general project browser it has every existing project a user has, showing them in a grid like structure, with their names and a preview of their doc. The front end should query the backend to reteirve the list of existing projects, then display them, for now since preview is a bit advance just have it be a page like logo above the name like a file. When a user double clicks on a project it should open that projects specific page, that is the next page to work on.

## Project page

There are three major components for the project page:

- File browser: the file browers should query the backend for the list of files within the project. Projects right now are structured as directories, such that they may have subdirectories. The user should be able to drag the and dock the file browser on each side of the screen.
- Page: the page is the main point of interest here, the goal with moonstone is to copy obsidians inline rendering when the cursor isn't hovering a code segment. For speed only items that are view able should be rendered from their raw text, and all math, tables, specail characters, and other special latex things should be renderable. Some parst of latex such as \begindocument should be rendered specailly. Like in obsidian when you create an HTML block its tags are hidden and as special box is created around the items it contains. I also think document attrobutes should be hidden untill the cursor goes outside the box, please impliment this in a way that is very user friendly. 
- Toolbar: The toolbar should give the user abilty to insterted all the special latex features, such as characters, math, and tables. It should also allow the user to save, undo, redo, and exit the project. 



## Settings page

TODO later.




# Testing

Testing is very important, within the source folder, create a test folder, and then add test suites for each page seperatly.

# Documentation

Documentation and reability are very important, every class and function should have a brief comment explaning its intent, for functions they should also describe, their params and return type. Also within each page feature create a short md file, explaining how the feature works.

# Coding style

Bellow is a list you should follow for writing code to maximize quality.

---

# 1. Correctness

The most important quality.

### Types

* Prefer `unknown` over `any`
* Never use `any` unless absolutely necessary
* Enable strict mode
* Use strict null checks
* Avoid type assertions (`as`) whenever possible
* Prefer inference when obvious
* Explicitly annotate public APIs
* Use discriminated unions instead of boolean flags
* Prefer literal types
* Use readonly whenever data shouldn't mutate
* Model impossible states as impossible
* Encode invariants in types

Good

```ts
type Success = {
    ok: true
    data: User
}

type Failure = {
    ok: false
    error: Error
}

type Result = Success | Failure
```

instead of

```ts
{
    success: boolean
    data?: User
    error?: Error
}
```

---

### Null Safety

Never assume something exists.

Bad

```ts
user.address.city
```

Better

```ts
user.address?.city
```

or validate first.

---

### Exhaustive checking

Always exhaust unions.

```ts
switch(event.type){
    case "login":
    case "logout":
        break

    default:
        assertNever(event)
}
```

---

# 2. Readability

The code should explain itself.

## Naming

Variables describe data

```ts
const user
const totalPrice
const retryCount
```

Functions describe actions

```ts
calculateTax()
fetchOrders()
sendEmail()
```

Booleans answer questions

```ts
isReady
hasPermission
canRetry
shouldRefresh
```

Avoid

```
tmp
foo
bar
obj
data
thing
x
y
```

---

## Function Size

Ideal

10–30 lines

Questionable

50+

Bad

100+

---

## Nesting

Avoid

```ts
if(){
    if(){
        if(){
```

Prefer

```ts
if(!user) return

if(!user.admin) return

...
```

Guard clauses reduce cognitive load.

---

## Single Responsibility

Each function should do one thing.

Bad

```ts
function createUser(){
    validate()
    hashPassword()
    save()
    sendEmail()
    log()
}
```

Better

```ts
createUser()
```

calls

```
validateUser()
persistUser()
notifyUser()
```

---

## Comments

Write comments explaining **why**, not **what**.

Bad

```ts
// increment i
i++
```

Good

```ts
// Retry because Stripe occasionally returns transient failures.
```

---

# 3. Maintainability

Avoid duplication.

DRY

Don't Repeat Yourself.

If identical logic appears twice

Extract it.

---

## SOLID

### S

Single Responsibility

---

### O

Open Closed Principle

Prefer extension instead of modification.

---

### L

Liskov Substitution

Subtypes should behave correctly.

---

### I

Interface Segregation

Small interfaces.

Not

```ts
interface Everything
```

---

### D

Dependency Inversion

Depend on abstractions.

---

# 4. Simplicity

KISS

Keep It Simple.

---

YAGNI

Don't build future features you don't need.

Avoid

```ts
UserFactoryBuilderRegistry
```

when

```ts
new User()
```

works.

---

# 5. Architecture

Separate

* API
* Business logic
* Database
* UI
* Utilities

Don't mix.

---

Avoid circular dependencies.

---

Keep modules cohesive.

---

Prefer composition over inheritance.

---

# 6. Performance

Don't optimize prematurely.

But avoid obvious mistakes.

---

Avoid

```ts
array.includes()
```

inside loops.

Use

```ts
Set
```

---

Avoid repeated allocations.

---

Memoize expensive computations.

---

Lazy load expensive modules.

---

Avoid unnecessary object copying.

---

Prefer streaming over loading huge files.

---

Measure before optimizing.

---

# 7. Memory

Avoid leaks.

Remove listeners.

Dispose timers.

Abort fetches.

Free resources.

---

Avoid unnecessary closures.

---

Avoid retaining large objects accidentally.

---

# 8. Error Handling

Never ignore errors.

Bad

```ts
catch(e){}
```

---

Good

```ts
catch(err){
    logger.error(err)
    throw err
}
```

---

Throw domain-specific errors.

---

Prefer Result types when appropriate.

---

Never swallow promises.

---

# 9. Async

Never forget

```ts
await
```

---

Avoid

```ts
await a()
await b()
```

when independent.

Prefer

```ts
await Promise.all()
```

---

Always handle rejections.

---

Support AbortSignal.

---

Avoid blocking event loop.

---

# 10. Security

Never trust input.

Validate everything.

---

Escape HTML.

---

Sanitize SQL.

---

Parameterized queries.

Never

```sql
SELECT * FROM users WHERE id=${id}
```

---

Never store plaintext passwords.

---

Hash passwords.

---

Avoid secrets in source.

---

Rotate credentials.

---

Validate JWTs.

---

Rate limit endpoints.

---

Avoid XSS.

---

Avoid CSRF.

---

Validate uploads.

---

Limit upload size.

---

Never expose stack traces.

---

Least privilege.

---

# 11. API Design

Small interfaces.

Consistent naming.

Predictable behavior.

No surprising side effects.

---

Pure functions whenever possible.

---

Avoid optional parameters explosion.

Prefer

```ts
createUser({
    ...
})
```

---

Version APIs.

---

# 12. Functional Programming

Prefer immutable data.

---

Pure functions.

---

No hidden state.

---

Avoid mutation.

---

Use map/filter/reduce carefully.

---

Avoid reduce abuse.

---

# 13. Testing

Unit tests.

Integration tests.

E2E tests.

---

Arrange

Act

Assert

---

Test behavior.

Not implementation.

---

Avoid brittle mocks.

---

Deterministic tests.

---

Fast tests.

---

# 14. Logging

Structured logging.

Good

```ts
logger.info({
    userId,
    orderId
})
```

---

Avoid

```ts
console.log("hello")
```

---

Don't log secrets.

---

Use levels

Debug

Info

Warn

Error

---

# 15. Documentation

Public APIs documented.

README updated.

Examples.

Architecture docs.

ADR when necessary.

---

# 16. TypeScript Specific

Prefer interfaces for object shapes.

Prefer type aliases for unions.

---

Avoid enums.

Prefer

```ts
const Status = {
    Active: "active"
} as const
```

---

Use utility types

```
Pick
Omit
Partial
Required
Readonly
Record
```

---

Use generics correctly.

---

Avoid deep generic insanity.

---

Prefer satisfies

```ts
const config = {
    ...
} satisfies Config
```

---

Use branded types when IDs differ.

```ts
type UserId = string & {
    readonly brand: unique symbol
}
```

---

# 17. Code Smells

Long functions.

Large classes.

Boolean parameters.

Magic numbers.

Deep nesting.

Duplicate code.

God objects.

Shotgun surgery.

Feature envy.

Primitive obsession.

Long parameter lists.

Hidden side effects.

Mutable globals.

---

# 18. Readability Heuristics

Can a new engineer understand it in 30 seconds?

Can names explain everything?

Can a bug be isolated easily?

Can functions fit on one screen?

Can modules be understood independently?

---

# 19. Dependency Management

Small dependency tree.

Avoid abandoned packages.

Keep versions updated.

Pin critical versions.

Audit vulnerabilities.

Avoid unnecessary dependencies.

---

# 20. Code Review Checklist

For every PR ask:

* Is it correct?
* Is it readable?
* Is it maintainable?
* Is it secure?
* Is it performant?
* Is it testable?
* Is it documented?
* Does it duplicate logic?
* Does it follow project conventions?
* Are edge cases handled?
* Are errors handled?
* Is the public API intuitive?
* Is the code simpler than before?

---

# 21. Production Engineering Practices

Beyond the code itself, production-quality TypeScript systems benefit from operational discipline:

* Enable strict TypeScript compiler options (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, etc.).
* Use ESLint with a consistent ruleset and treat important warnings as errors.
* Use Prettier (or another formatter) to eliminate formatting debates.
* Automate checks in CI: type checking, linting, tests, security scans, and build verification.
* Keep commits and pull requests focused on a single logical change.
* Write migration scripts for schema changes.
* Prefer feature flags over long-lived branches for incremental rollouts.
* Design for observability with metrics, tracing, and structured logging.
* Consider backwards compatibility when evolving APIs.
* Document architectural decisions (ADRs) for significant design choices.

---

## Core Principles

Nearly every guideline above supports one or more of these fundamental goals:

1. **Correctness** — The code behaves as intended, including edge cases.
2. **Readability** — Future developers can understand it quickly.
3. **Maintainability** — Changes are localized and low risk.
4. **Extensibility** — New features can be added without major rewrites.
5. **Performance** — Efficient use of CPU, memory, network, and I/O where it matters.
6. **Security** — Untrusted input and sensitive data are handled safely.
7. **Reliability** — Failures are anticipated, isolated, and recoverable.
8. **Testability** — Components can be verified independently and automatically.
9. **Consistency** — Similar problems are solved in similar ways across the codebase.
10. **Simplicity** — The simplest design that satisfies the current requirements is usually the best.

A useful rule during code review is to ask: **Does this change make the code easier or harder to understand, modify, and trust?** If it makes any of those significantly worse without a compelling benefit, it's usually worth revisiting the design.
