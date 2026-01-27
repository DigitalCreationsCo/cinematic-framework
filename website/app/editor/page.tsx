'use client'

import React, { useState, useEffect } from 'react'
import { MarkdownEditor } from '@/components/editor/markdown-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface UpdateFile {
  slug: string
  filename: string
}

export default function EditorPage() {
  const [updates, setUpdates] = useState<UpdateFile[]>([])
  const [currentSlug, setCurrentSlug] = useState('')
  const [originalSlug, setOriginalSlug] = useState('')
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    fetchUpdates()
  }, [])

  const fetchUpdates = async () => {
    const res = await fetch('/api/updates')
    if (res.ok) {
      const data = await res.json()
      setUpdates(data)
    }
  }

  const loadUpdate = async (slug: string) => {
    setIsLoading(true)
    try {
        // We can fetch the raw content if we had an API for it, 
        // or just rely on the fact that we might need to fetch it via a new GET param or just GET /api/updates?slug=...
        // For now let's quickly update the GET api to return content if queried, or just making a dedicated endpoint.
        // Actually, let's just use the GET api I wrote? 
        // Wait, the GET api currently only lists files. 
        // I need to update it to support fetching content or just add a query param.
        
        // Let's assume for this step I'll update the API to return content if ?slug= is present.
        // Alternatively I can try to fetch the file directly? No, that's static.
        
        // I'll update the API route in a moment. For now, let's assume '/api/updates?slug=' works.
         const res = await fetch(`/api/updates?slug=${slug}`)
         if (res.ok) {
             const data = await res.json()
             setContent(data.content)
             setCurrentSlug(slug)
             setOriginalSlug(slug)
         }
    } finally {
        setIsLoading(false)
    }
  }

  const saveUpdate = async () => {
    if (!currentSlug) return

    setIsLoading(true)
    try {
      const res = await fetch('/api/updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: currentSlug,
          content,
          originalSlug
        })
      })
      
      if (res.ok) {
        await fetchUpdates()
        setOriginalSlug(currentSlug)
        alert('Saved!')
      } else {
        alert('Failed to save')
      }
    } finally {
      setIsLoading(false)
    }
  }
  
  const createNew = () => {
      setCurrentSlug('new-update')
      setOriginalSlug('')
      setContent('# New Update\n\n')
  }

  if (process.env.NODE_ENV === 'production') {
      return <div>Access Denied</div>
  }

  return (
    <div className="flex h-screen">
      <div className="w-64 border-r p-4 bg-muted/10 overflow-auto">
        <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold">Updates</h2>
            <Button size="sm" onClick={createNew} variant="outline">+</Button>
        </div>
        <div className="space-y-2">
          {updates.map(u => (
            <div 
              key={u.slug}
              onClick={() => loadUpdate(u.slug)}
              className={`p-2 cursor-pointer hover:bg-muted rounded text-sm ${currentSlug === u.slug ? 'bg-muted font-medium' : ''}`}
            >
              {u.slug}
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 flex flex-col h-full">
        <div className="border-b p-4 flex items-center gap-4">
             <Input 
                value={currentSlug} 
                onChange={e => setCurrentSlug(e.target.value)}
                placeholder="slug-name"
                className="max-w-xs"
             />
             <Button onClick={saveUpdate} disabled={isLoading}>
                 {isLoading ? 'Saving...' : 'Save'}
             </Button>
        </div>
        <div className="flex-1 overflow-auto p-4">
            <MarkdownEditor value={content} onChange={v => setContent(v || '')} />
        </div>
      </div>
    </div>
  )
}
