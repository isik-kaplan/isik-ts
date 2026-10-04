# Naming

Every exported name follows four rules. They are written down so they hold as a rule rather than by habit.

1. **Spell words out.** No truncations in an exported name. A universal, platform-sanctioned abbreviation stays: `Id` (as in `getElementById`), `Env`, `Config`, `Int` (as in `parseInt`) and `Props` (React's).
2. **An acronym is uppercase, except as a leading camelCase segment.** `useAPISubmit`, `downloadURL`, `hexToHSLTriplet` - as `encodeURIComponent` and `toJSON` do. A leading acronym stays lowercase (`jsStringLiteral`), because an uppercase first letter makes a name PascalCase, which reads as a class or a component.
3. **American spelling**, in identifiers, comments, test names and docs alike.
4. **A name says what the thing is for, not how it was built.**
