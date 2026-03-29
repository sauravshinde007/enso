// src/components/HeroPage.jsx
import React from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import AnimatedGroup from '../components/ui/AnimatedGroup'         // fixed path
import { Button } from '../components/ui/Button'                    // fixed path
import { cn } from '../lib/utils'                                   // fixed path 

export default function HomePage() {
  return (
    <div className="min-h-screen relative bg-black text-[#e6e7ea] overflow-hidden">
      {/* Background Gradients */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        {/* Cyan/Teal glow - Higher and brighter */}
        <div className="absolute bottom-[-5%] left-[-10%] w-[60vw] h-[60vw] rounded-full bg-[#00ffff] opacity-[0.35] blur-[160px]" />
        {/* Blue/Indigo glow - Higher and with more presence */}
        <div className="absolute bottom-[-5%] right-[-10%] w-[60vw] h-[60vw] rounded-full bg-[#0044ff] opacity-[0.4] blur-[160px]" />
      </div>

      <Header />

      {/* Hero main */}
      <main className="relative z-10 pt-32 pb-16">
        <div className="mx-auto max-w-7xl px-6 flex flex-col items-center text-center">

          <AnimatedGroup
            className="flex flex-col items-center"
            variants={{
              container: {
                hidden: { opacity: 0 },
                visible: {
                  opacity: 1,
                  transition: { staggerChildren: 0.1, delayChildren: 0.2 },
                },
              },
              item: {
                hidden: { opacity: 0, y: 20 },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: { type: 'spring', bounce: 0.4, duration: 1.0 },
                },
              },
            }}
          >
            {/* Pill */}
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-4 py-1.5 text-sm text-zinc-300 backdrop-blur-sm hover:border-zinc-700 transition cursor-default">
              <span className="flex h-2 w-2 rounded-full bg-[#9b99fe] animate-pulse"></span>
              <span>Join the revolution today</span>
              <span className="text-zinc-500 ml-1">→</span>
            </div>

            {/* Title */}
            <h1 className="mx-auto max-w-5xl text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1] mb-6">
              Metaverse for <br className="hidden md:block" />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#9b99fe] to-[#2bc8b7]">
                Remote Collaborations
              </span>
            </h1>

            {/* Description */}
            <p className="mx-auto max-w-3xl text-lg md:text-xl text-zinc-400 mb-10 leading-relaxed">
              Build collaborative virtual spaces and modern web experiences with composable UI,
              realtime features, and tools that fit your workflow.
            </p>

            {/* Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
              <Button as="link" to="/signup" variant="primary" className="h-12 px-8 text-base rounded-full hover:scale-105 active:scale-95 transition-transform duration-200">
                Start Your Free Trial
              </Button>
              <Button as="link" to="/login" variant="ghost" className="h-12 px-8 text-base rounded-full border border-zinc-700 hover:bg-zinc-800 hover:text-white transition-colors">
                Watch Demo
              </Button>
            </div>
          </AnimatedGroup>

          {/* Large Preview Image */}
          <AnimatedGroup
            className="mt-20 w-full max-w-6xl"
            variants={{
              container: { hidden: { opacity: 0, y: 40 }, visible: { opacity: 1, y: 0 } },
              item: { hidden: { opacity: 0, scale: 0.95 }, visible: { opacity: 1, scale: 1, transition: { duration: 1.2, ease: "easeOut" } } },
            }}
          >
            <div className="relative rounded-2xl border border-zinc-800 bg-zinc-900/40 p-2 shadow-2xl backdrop-blur-md">
              <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-zinc-500/50 to-transparent opacity-50" />
              <video
                src="/assets/intro.mp4"
                autoPlay
                loop
                muted
                playsInline
                className="w-full rounded-xl shadow-inner border border-zinc-200 dark:border-zinc-700/50"
              />
            </div>
          </AnimatedGroup>
        </div>
      </main>
    </div>
  )
}

function Header() {
  const [open, setOpen] = React.useState(false)
  const [scrolled, setScrolled] = React.useState(false)

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className="fixed top-4 left-0 right-0 z-30 px-4">
      <div
        className={cn(
          'mx-auto flex items-center justify-between gap-4 rounded-2xl transition-all duration-300 border p-3 ease-in-out',
          scrolled
            ? 'bg-zinc-900/80 border-zinc-700 shadow-xl max-w-4xl backdrop-blur-md'
            : 'bg-zinc-900/35 border-zinc-700/70 max-w-7xl backdrop-blur-sm'
        )}
      >
        {/* Logo / brand - properly aligned */}
        <Link to="/" className="flex items-center gap-3">
          <img
            src="/logos/logowText-cropped.svg"
            alt="Metaverse"
            className="h-7 w-auto object-contain"
          />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-6">
          <a href="#features" className="text-sm text-zinc-300 hover:text-white">
            Features
          </a>
          <a href="#solution" className="text-sm text-zinc-300 hover:text-white">
            Solution
          </a>
          <a href="#pricing" className="text-sm text-zinc-300 hover:text-white">
            Pricing
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden md:block">
            <Link to="/login" className="text-sm text-zinc-200 hover:text-white">
              Login
            </Link>
          </div>
          <div className="hidden md:block">
            <Button as="link" to="/signup" variant="primary" className="px-4 py-1 text-sm">
              Sign up
            </Button>
          </div>

          {/* Mobile menu button */}
          <button
            aria-label="Toggle menu"
            onClick={() => setOpen((prev) => !prev)}
            className="block lg:hidden p-2 rounded-md bg-zinc-800/40 border border-zinc-700"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="mt-2 mx-auto max-w-7xl rounded-2xl bg-zinc-900/80 border border-zinc-800 p-4 lg:hidden">
          <ul className="flex flex-col gap-3 text-sm">
            <li>
              <a href="#features" onClick={() => setOpen(false)}>
                Features
              </a>
            </li>
            <li>
              <a href="#solution" onClick={() => setOpen(false)}>
                Solution
              </a>
            </li>
            <li>
              <a href="#pricing" onClick={() => setOpen(false)}>
                Pricing
              </a>
            </li>
            <li className="mt-2">
              <Link to="/login" onClick={() => setOpen(false)} className="block">
                Login
              </Link>
            </li>
            <li>
              <Link to="/signup" onClick={() => setOpen(false)} className="block">
                Sign Up
              </Link>
            </li>
          </ul>
        </div>
      )}
    </header>
  )
}
