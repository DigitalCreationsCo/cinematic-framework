'use client';

import {
  MDXEditor,
  MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  imagePlugin,
  linkPlugin,
  linkDialogPlugin,
  codeBlockPlugin,
  frontmatterPlugin
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { forwardRef } from 'react';

interface EditorProps {
  markdown: string;
  onChange: (markdown: string) => void;
}

const Editor = forwardRef<MDXEditorMethods, EditorProps>(({ markdown, onChange }, ref) => {
  return (
    <MDXEditor
      ref={ ref }
      markdown={ markdown }
      onChange={ onChange }
      className="min-h-[500px] border rounded-md"
      contentEditableClassName="mdxeditor-content typography prose-zinc dark:prose-invert max-w-none min-h-[500px] p-4"
      plugins={ [
        headingsPlugin(),
        listsPlugin(),
        quotePlugin(),
        thematicBreakPlugin(),
        markdownShortcutPlugin(),
        imagePlugin(),
        linkPlugin(),
        linkDialogPlugin(),
        codeBlockPlugin({ defaultCodeBlockLanguage: 'js' })
      ] }
    />
  );
});

Editor.displayName = 'Editor';

export default Editor;
