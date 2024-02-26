import { useTheme } from 'next-themes'
import { FaRegMoon as Moon, FaSun as Sun } from 'react-icons/fa'
import { CgFormatSlash } from "react-icons/cg";

export const ThemeChanger = () => {
  const { theme, setTheme } = useTheme()

  const toggleTheme = () => {
    if (theme === 'system') {
      const systemThemeIsDark = window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(systemThemeIsDark ? 'cupcake' : 'dark')
    } else {
      setTheme(theme === 'dark' ? 'cupcake' : 'dark')
    }
  }

  return (
    <div onClick={() => toggleTheme()}>
      <button className="flex">
        <Sun className="inline" /> <CgFormatSlash /> <Moon className="inline" />
      </button>
    </div>
  )
}