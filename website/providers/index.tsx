import { ViewTransitions } from '#w/lib/transition/index.js';
import { ThemeProvider } from '#w/providers/theme/index.js'

export const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ViewTransitions>{children}</ViewTransitions>
    </ThemeProvider>
  )
}
