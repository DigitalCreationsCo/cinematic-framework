import { Link } from 'lib/transition'
import { buttonVariants } from '@/components/ui/button'
import { PageRoutes } from '@/lib/pageroutes'

export default function Home() {
  return (
    <section className="flex min-h-[86.5vh] flex-col items-center justify-center px-2 py-8 text-center">
      <h1 className="mb-4 text-4xl sm:text-7xl font-zalando-sans">Cinematic Canvas</h1>
      <p className="mb-8 max-w-150 text-foreground sm:text-base">
        A Generative Cinema Tool
      </p>

      <div className="flex items-center gap-5">
        <Link
          href={`/docs${PageRoutes[0].href}`}
          className={buttonVariants({ className: 'px-6', size: 'lg' })}
        >
          Get Started
        </Link>
      </div>
    </section>
  )
}
