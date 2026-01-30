'use client'

import dynamic from 'next/dynamic'

export const FileTree = dynamic(() => import('#w/components/markdown/filetree/component.js'), {
  ssr: false,
})
