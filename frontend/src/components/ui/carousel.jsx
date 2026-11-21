// src/components/ui/carousel.jsx
import React, { useState, useEffect, useRef } from "react"

export function Carousel({ items, activeIndex, setActiveIndex, autoPlayInterval = 3500, className }) {
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
  const startXRef = useRef(0)

  const prev = () => setActiveIndex((curr) => (curr === 0 ? items.length - 1 : curr - 1))
  const next = () => setActiveIndex((curr) => (curr === items.length - 1 ? 0 : curr + 1))

  // Automatic slide changer (every 3.5s, pauses briefly when user is dragging or hovering)
  useEffect(() => {
    if (isDragging || isHovered) return
    const timer = setInterval(() => {
      setActiveIndex((curr) => (curr === items.length - 1 ? 0 : curr + 1))
    }, autoPlayInterval)
    return () => clearInterval(timer)
  }, [items.length, isDragging, isHovered, autoPlayInterval, setActiveIndex])

  // Mouse drag handlers
  const handleMouseDown = (e) => {
    setIsDragging(true)
    startXRef.current = e.clientX
    setDragOffset(0)
  }

  const handleMouseMove = (e) => {
    if (!isDragging) return
    const currentX = e.clientX
    const diff = currentX - startXRef.current
    setDragOffset(diff)
  }

  const handleMouseUp = () => {
    if (!isDragging) return
    if (dragOffset < -40) {
      next()
    } else if (dragOffset > 40) {
      prev()
    }
    setIsDragging(false)
    setDragOffset(0)
  }

  // Touch drag handlers
  const handleTouchStart = (e) => {
    setIsDragging(true)
    startXRef.current = e.touches[0].clientX
    setDragOffset(0)
  }

  const handleTouchMove = (e) => {
    if (!isDragging) return
    const currentX = e.touches[0].clientX
    const diff = currentX - startXRef.current
    setDragOffset(diff)
  }

  const handleTouchEnd = () => {
    handleMouseUp()
  }

  return (
    <div
      className={`relative w-full overflow-hidden select-none ${className || ""}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false)
        if (isDragging) handleMouseUp()
      }}
    >
      {/* Slides Viewport with Mouse Drag Support */}
      <div
        className={`w-full flex ${isDragging ? "cursor-grabbing" : "cursor-grab"} ${
          isDragging ? "transition-none" : "transition-transform duration-500 ease-out"
        }`}
        style={{
          transform: `translateX(calc(-${activeIndex * 100}% + ${dragOffset}px))`
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {items.map((item, index) => (
          <div key={index} className="w-full shrink-0 flex items-center justify-center p-2">
            {item}
          </div>
        ))}
      </div>

      {/* Interactive Dots Navigation (No Prev / Next buttons) */}
      <div className="flex justify-center items-center gap-2 mt-4">
        {items.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActiveIndex(i)}
            aria-label={`Go to slide ${i + 1}`}
            className={`h-2 rounded-full transition-all duration-300 cursor-pointer ${
              activeIndex === i
                ? "w-6 bg-blue-600 shadow-xs shadow-blue-500/25"
                : "w-2 bg-slate-200 hover:bg-slate-300"
            }`}
          />
        ))}
      </div>
    </div>
  )
}