import { promises as fs } from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'

const isDev = process.env.NODE_ENV !== 'production'
const uploadDir = path.join(process.cwd(), 'public/uploads')

export async function POST(req: Request) {
  if (!isDev) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    await fs.mkdir(uploadDir, { recursive: true })
    
    const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '')}`
    const filePath = path.join(uploadDir, filename)
    
    await fs.writeFile(filePath, buffer)
    
    return NextResponse.json({ 
      url: `/uploads/${filename}` 
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
