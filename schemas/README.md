# JSON Schemas

This directory contains JSON schemas used for validation and autocomplete in the extension.

## buildkite-pipeline.json

**Source:** https://github.com/buildkite/pipeline-schema
**Last Updated:** 2026-01-29
**Schema Version:** JSON Schema Draft 7
**Usage:** Fallback schema (used when remote schema is unavailable)

This schema provides validation, autocomplete, and hover documentation for Buildkite pipeline YAML files.

The extension uses an intelligent fallback mechanism:
1. **Primary**: Tries to use the latest schema from GitHub (always up-to-date)
2. **Fallback**: Uses this bundled local schema if remote is unavailable (works offline)

### Updating the Schema

To update to the latest version:

1. Visit https://github.com/buildkite/pipeline-schema
2. Download the latest schema.json from the main branch:
   ```bash
   curl -o schemas/buildkite-pipeline.json https://raw.githubusercontent.com/buildkite/pipeline-schema/main/schema.json
   ```
3. Update the "Last Updated" date above
4. Test with sample pipeline files to ensure validation works correctly
5. Commit the changes with a descriptive message

### Maintenance Schedule

Check for schema updates quarterly or when Buildkite announces new pipeline features.
