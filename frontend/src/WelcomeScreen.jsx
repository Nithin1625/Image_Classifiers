// src/screens/WelcomeScreen.jsx
import React, { useState } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Carousel } from "@/components/ui/carousel"
import { FolderPlus, Cpu, Sparkles, ArrowRight } from "lucide-react"

export default function WelcomeScreen({ onNext }) {
  const [slideIndex, setSlideIndex] = useState(0)

  const slideData = [
    {
      icon: <FolderPlus className="h-7 w-7" />,
      color: "bg-blue-50 text-blue-600 border border-blue-100",
      step: "Step 1",
      title: "Create Categories & Add Photos",
      desc: "Add labels such as Cats and Dogs, then upload sample photos for each class to build your training dataset."
    },
    {
      icon: <Cpu className="h-7 w-7" />,
      color: "bg-indigo-50 text-indigo-600 border border-indigo-100",
      step: "Step 2",
      title: "Train Your Model",
      desc: "Train a lightweight MobileNetV2 neural network in your browser with adjustable epochs and batch size."
    },
    {
      icon: <Sparkles className="h-7 w-7" />,
      color: "bg-emerald-50 text-emerald-600 border border-emerald-100",
      step: "Step 3",
      title: "Test Predictions & Save",
      desc: "Upload test photos to see real-time confidence scores, then export your model locally or to Google Drive."
    }
  ]

  const slides = slideData.map((s, i) => (
    <div key={i} className="flex flex-col items-center justify-center text-center px-2 py-1">
      <div className={`p-3.5 rounded-xl ${s.color} mb-3.5 shadow-2xs`}>
        {s.icon}
      </div>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{s.step}</span>
      <h4 className="font-semibold text-base text-slate-800 leading-snug mb-1.5">{s.title}</h4>
      <p className="text-xs sm:text-sm text-slate-500 leading-relaxed max-w-[320px]">
        {s.desc}
      </p>
    </div>
  ))

  return (
    <div className="w-full max-w-[460px] mx-auto px-4">
      <Card className="flex flex-col justify-between border border-slate-200/90 shadow-sm rounded-2xl bg-white">
        <CardHeader className="text-center pt-7 pb-2 px-6">
          <CardTitle className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Quick guide
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm text-slate-500 mt-1">
            Quick 3-step walkthrough to get you started
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col justify-center flex-1 px-4 py-4">
          <Carousel
            items={slides}
            activeIndex={slideIndex}
            setActiveIndex={setSlideIndex}
          />
        </CardContent>

        <CardFooter className="pb-7 px-6 flex flex-col gap-3">
          <Button
            variant="default"
            className="w-full h-11 text-sm font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-xs shadow-blue-500/20 active:scale-[0.99] transition-all group cursor-pointer"
            onClick={onNext}
          >
            <span>Start Building</span>
            <ArrowRight className="h-4 w-4 ml-1.5 text-white/80 group-hover:translate-x-1 group-hover:text-white transition-all" />
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
