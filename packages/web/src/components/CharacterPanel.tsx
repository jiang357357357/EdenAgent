export function CharacterPanel({ isThinking = false }: { isThinking?: boolean }) {
  const image = isThinking
    ? '/characters/sulan/04_thinking_chin_transparent.png'
    : '/characters/sulan/01_default_stand_transparent.png';

  return (
    <aside className="hidden aspect-[9/16] h-[100vh] shrink-0 items-end justify-center overflow-hidden border-l border-border bg-bg md:flex">
      <div className="relative h-full w-full">
        <img
          src={image}
          alt="苏岚"
          className="absolute bottom-0 left-1/2 h-[104%] w-auto max-w-none -translate-x-1/2 object-contain object-bottom"
          draggable={false}
        />
      </div>
    </aside>
  );
}
