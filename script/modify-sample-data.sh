#!/bin/bash

# Target file definition
FILE="server/sample.ts"

# Check if file exists
if [ ! -f "$FILE" ]; then
    echo "Error: File $FILE does not exist."
    exit 1
fi

echo "Processing $FILE..."

# We use Python for the transformation because it handles regex groups 
# and string formatting much more cleanly and safely than complex sed/awk chains.
python3 -c '
import re
import sys

file_path = "'"$FILE"'"

try:
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    def transform_uri(match):
        # Group 1 matches an existing key-value pair (e.g., storageUri: "gs://...")
        # We return these as-is to prevent double-wrapping.
        if match.group(1):
            return match.group(1)
        
        # Group 2 matches a standalone "gs://..." string
        gs_uri = match.group(2)
        
        # Strip "gs://" (5 chars) to build the public https url
        # Logic: gs://bucket/path -> https://storage.googleapis.com/bucket/path
        path = gs_uri[5:]
        public_uri = f"https://storage.googleapis.com/{path}"
        
        # Return the formatted object string
        return f"{{ storageUri: \"{gs_uri}\", publicUri: \"{public_uri}\" }}"

    # Regex breakdown:
    # 1. (storageUri:\s*"gs://[^"]*")  -> Look for "gs://" specifically preceded by "storageUri: " (ignoring whitespace)
    # 2. |                             -> OR
    # 3. "(gs://[^"]*)"                -> Look for any "gs://" string inside quotes
    pattern = r"(storageUri:\s*\"gs://[^\"\n]*\")|\"(gs://[^\"\n]*)\""

    # Apply substitution
    new_content, count = re.subn(pattern, transform_uri, content)

    # Write back to file
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(new_content)

    print(f"Transformation complete. Processed {count} URI instances.")

except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
'

echo "Done."