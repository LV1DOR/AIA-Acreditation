# ADR 0004: Immutable content and export adapters
Accepted.
Separate mutable registration workspaces from immutable submitted content and separate review decisions.
Freeze sensitive content with encryption, not plaintext JSON copies.
Exports also freeze data/photo versions. ExcelJS column mappings belong to versioned adapters.
WeBook and Matica provisional adapters are mandatory; real templates replace adapters without overwriting history.
Immutability does not override approved retention/legal hold obligations.

For the ID-ALL card export, the clarified operator scope in [ADR 0006](0006-id-all-manual-code-export.md)
supersedes the provisional card adapter and persistent export-history requirements above.

