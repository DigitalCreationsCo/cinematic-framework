'use client';

import { useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import type { MDXEditorMethods } from '@mdxeditor/editor';

// Dynamically import valid for Client Components too if intended to avoid SSR of that part
const Editor = dynamic(() => import('@/components/mdx-editor'), {
  ssr: false,
  loading: () => <p>Loading editor...</p>
});

export default function UpdatesEditorPage() {
  const [ slug, setSlug ] = useState('');
  const [ title, setTitle ] = useState('New Update');
  const [ description, setDescription ] = useState('Description of the update');
  const [ date, setDate ] = useState(new Date().toISOString().split('T')[ 0 ]);
  const [ content, setContent ] = useState('Start writing here...');
  const [ status, setStatus ] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const editorRef = useRef<MDXEditorMethods>(null);

  const handleSave = async () => {
    if (!slug) {
      alert('Please enter a slug');
      return;
    }

    const fullMarkdown = `---
title: "${title.replace(/"/g, '\\"')}"
description: "${description.replace(/"/g, '\\"')}"
date: "${date}"
---

${content}`;

    setStatus('saving');
    try {
      const res = await fetch('/api/save-update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ slug, content: fullMarkdown })
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      setStatus('success');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (error) {
      console.error(error);
      setStatus('error');
    }
  };

  return (
    <div className="container mx-auto py-10 space-y-6">
      <h1 className="text-3xl font-bold">New Update</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Slug (Filename)</label>
          <Input
            placeholder="e.g. my-new-feature"
            value={ slug }
            onChange={ (e) => setSlug(e.target.value) }
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Date</label>
          <Input
            type="date"
            value={ date }
            onChange={ (e) => setDate(e.target.value) }
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium">Title</label>
          <Input
            placeholder="Enter post title"
            value={ title }
            onChange={ (e) => setTitle(e.target.value) }
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium">Description</label>
          <Input
            placeholder="Enter brief description"
            value={ description }
            onChange={ (e) => setDescription(e.target.value) }
          />
        </div>
      </div>

      <div className="border rounded-lg p-2 min-h-[500px]">
        <Editor
          ref={ editorRef }
          markdown={ content }
          onChange={ setContent }
        />
      </div>

      <div className="flex items-center gap-4">
        <Button onClick={ handleSave } disabled={ status === 'saving' }>
          { status === 'saving' ? 'Saving...' : 'Save Update' }
        </Button>
        { status === 'success' && <span className="text-green-500">Saved!</span> }
        { status === 'error' && <span className="text-red-500">Error saving.</span> }
      </div>
    </div>
  );
}
