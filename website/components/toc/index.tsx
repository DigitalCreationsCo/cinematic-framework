import { TableAnchor, TableAnchorProps } from '#w/components/toc/anchor.js';
import { BackToTop } from '#w/components/toc/backtotop.js';
import Feedback from '#w/components/toc/feedback.js';
import { Settings } from '#w/types/settings.js'

interface TableProps {
  tocs: TableAnchorProps
  pathName: string
  frontmatter: { title: string }
}

export function TableOfContents({ tocs, pathName, frontmatter }: TableProps) {
  return (
    <>
      {Settings.rightbar && (
        <aside
          className="toc sticky top-26 hidden h-screen max-w-md gap-3 xl:flex xl:flex-col"
          aria-label="Table of contents"
        >
          {Settings.toc && <TableAnchor tocs={tocs.tocs} />}
          {Settings.feedback && <Feedback slug={pathName} title={frontmatter.title} />}
          {Settings.totop && <BackToTop />}
        </aside>
      )}
    </>
  )
}
