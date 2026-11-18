package aidiagnosis

import _ "embed"

//go:embed prompt/system.md
var systemPrompt string

//go:embed prompt/output.schema.json
var outputSchema string

//go:embed prompt/sample_input.json
var sampleInput []byte
