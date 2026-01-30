import { ComponentProps } from 'react'

import Copy from '#w/components/markdown/copy.js'

export default function Pre({ children, raw, ...rest }: ComponentProps<'pre'> & { raw?: string }) {
  return (
    <div className="relative my-5">
      <div className="absolute top-3 right-2.5 z-10 hidden sm:block">
        <Copy content={raw!} />
      </div>
      <div className="relative">
        <pre {...rest}>{children}</pre>
      </div>
    </div>
  )
}
