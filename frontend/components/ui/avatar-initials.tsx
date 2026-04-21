interface AvatarInitialsProps {
    name: string
    color?: string
    size?: "sm" | "md" | "lg"
  }
  
  export function AvatarInitials({ name, color = "#7C3AED", size = "md" }: AvatarInitialsProps) {
    const initials = name
      .split(" ")
      .map((n: any) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  
    const sizeClasses = {
      sm: "h-8 w-8 text-xs",
      md: "h-10 w-10 text-sm",
      lg: "h-12 w-12 text-base",
    }
  
    return (
      <div
        className={`flex items-center justify-center rounded-full font-semibold text-white ${sizeClasses[size]}`}
        style={{ backgroundColor: color }}
      >
        {initials}
      </div>
    )
  }
  