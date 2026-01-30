'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import "@uiw/react-md-editor/dist/mdeditor.css";
import "@uiw/react-markdown-preview/dist/markdown.css";

const MDEditor = dynamic(() => import('@uiw/react-md-editor'), { ssr: false })

interface MarkdownEditorProps {
  value: string
  onChange: (value?: string) => void
}

export function MarkdownEditor({ value, onChange }: MarkdownEditorProps) {
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  const onImageUpload = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    })
    
    if (!res.ok) throw new Error('Upload failed')
    
    const data = await res.json()
    return data.url
  }

  return (
    <div data-color-mode="dark">
      <MDEditor
        value={value}
        onChange={onChange}
        height={800}
        preview="live"
        onPaste={async (event) => {
          const items = event.clipboardData.items
          for (const item of items) {
             if (item.kind === 'file' && item.type.startsWith('image/')) {
               event.preventDefault()
               const file = item.getAsFile()
               if (file) {
                 const url = await onImageUpload(file)
                 const insertion = `![${file.name}](${url})`
                 // This is a bit tricky with MDEditor controlled input, 
                 // ideally we'd insert at cursor, but appending is safer for now 
                 // unless we implement full cursor handling.
                 // For now let's just use the built-in image command if possible or this basic paste.
                 onChange(value + '\n' + insertion)
               }
             }
          }
        }}
      />
    </div>
  )
}
