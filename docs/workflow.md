```mermaid
graph TD
    A[START] --> B{Resume / Regenerate?};
    B -- Has Scenes / Regenerating --> G[process_scene];
    B -- Has Prompt --> E[generate_character_assets];
    B -- New Run --> C[expand_creative_prompt];
    C --> D{Has Audio?};
    D -- No --> H[generate_storyboard_exclusively_from_prompt];
    D -- Yes --> F[create_scenes_from_audio];
    F --> I[enrich_storyboard_and_scenes];
    H --> E;
    I --> E;
    E --> J[generate_location_assets];
    J --> G;
    G --> K{All Scenes Processed?};
    K -- No --> G;
    K -- Yes --> L[render_video];
    L --> M[finalize];
    M --> N[END];
```
