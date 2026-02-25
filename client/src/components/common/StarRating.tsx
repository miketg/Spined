import { Star, StarHalf } from "lucide-react";
import { useState } from "react";

interface StarRatingProps {
  rating: number;
  maxRating?: number;
  size?: "sm" | "md" | "lg";
  interactive?: boolean;
  onChange?: (rating: number) => void;
}

const sizeMap = {
  sm: "w-3.5 h-3.5",
  md: "w-5 h-5",
  lg: "w-6 h-6",
};

export function StarRating({
  rating,
  maxRating = 5,
  size = "md",
  interactive = false,
  onChange,
}: StarRatingProps) {
  const [hoverRating, setHoverRating] = useState(0);
  const displayRating = hoverRating || rating;
  const iconSize = sizeMap[size];

  const handleClick = (starIndex: number, isHalf: boolean) => {
    if (!interactive || !onChange) return;
    const newRating = isHalf ? starIndex + 0.5 : starIndex + 1;
    onChange(newRating === rating ? 0 : newRating);
  };

  const handleMouseMove = (e: React.MouseEvent, starIndex: number) => {
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const isLeftHalf = e.clientX - rect.left < rect.width / 2;
    setHoverRating(isLeftHalf ? starIndex + 0.5 : starIndex + 1);
  };

  return (
    <div
      className="flex items-center gap-0.5"
      onMouseLeave={() => setHoverRating(0)}
      data-testid="star-rating"
    >
      {Array.from({ length: maxRating }).map((_, i) => {
        const filled = displayRating >= i + 1;
        const halfFilled = !filled && displayRating >= i + 0.5;

        return (
          <button
            key={i}
            type="button"
            className={`relative ${interactive ? "cursor-pointer" : "cursor-default"} focus:outline-none`}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const isHalf = e.clientX - rect.left < rect.width / 2;
              handleClick(i, isHalf);
            }}
            onMouseMove={(e) => handleMouseMove(e, i)}
            data-testid={`star-${i + 1}`}
            disabled={!interactive}
          >
            {filled ? (
              <Star className={`${iconSize} fill-amber-400 text-amber-400`} />
            ) : halfFilled ? (
              <div className="relative">
                <Star className={`${iconSize} text-muted-foreground/30`} />
                <div className="absolute inset-0 overflow-hidden w-1/2">
                  <Star className={`${iconSize} fill-amber-400 text-amber-400`} />
                </div>
              </div>
            ) : (
              <Star className={`${iconSize} text-muted-foreground/30`} />
            )}
          </button>
        );
      })}
    </div>
  );
}
