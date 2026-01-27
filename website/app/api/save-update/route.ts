import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { slug, content } = await req.json()

    if (!slug || !content) {
      return NextResponse.json({ error: 'Missing slug or content' }, { status: 400 })
    }

    // Ensure slug is safe (basic validation)
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json({ error: 'Invalid slug. Use lowercase letters, numbers, and hyphens only.' }, { status: 400 })
    }

    const updatesDirectory = path.join(process.cwd(), 'contents/updates')
    const filePath = path.join(updatesDirectory, `${slug}.mdx`)

    await fs.writeFile(filePath, content, 'utf-8')

    return NextResponse.json({ success: true, message: `Saved to ${slug}.mdx` })
  } catch (error) {
    console.error('Error saving update:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
