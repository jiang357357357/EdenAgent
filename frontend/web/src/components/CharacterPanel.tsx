import { Bot, ImageOff } from 'lucide-react';
import { motion } from 'motion/react';
import { resolveCoreAssetUrl, type CoreAssistant } from '../lib/auth';

const standeeTransition = {
  duration: 0.34,
  ease: [0.16, 1, 0.3, 1],
} as const;

interface CharacterPanelProps {
  assistant?: CoreAssistant | null;
  assistantError?: string;
}

export function CharacterPanel({ assistant, assistantError }: CharacterPanelProps) {
  const character = assistant?.character;
  const displayName = assistant?.name || character?.name || '默认助手';
  const image = resolveCoreAssetUrl(character?.default_standing_image_url || character?.avatar_url);

  return (
    <aside className="flex h-[100vh] w-[34vw] flex-none items-end justify-center overflow-hidden border-l border-border bg-bg">
      <div className="relative h-full w-full overflow-hidden">
        {image ? (
          <motion.img
            layoutId="mon-agent-character-standee"
            transition={standeeTransition}
            src={image}
            alt={displayName}
            className="absolute bottom-0 left-1/2 h-[96vh] w-auto max-w-none -translate-x-1/2 object-contain object-bottom"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-[3vw] text-center">
            <div className="rounded-3xl border border-border bg-card/80 p-[4vh] shadow-sm">
              <div className="mx-auto mb-[2vh] flex h-[8vh] w-[8vh] items-center justify-center rounded-2xl border border-border bg-bg text-text-muted">
                {assistant ? <ImageOff className="h-[4vh] w-[4vh]" /> : <Bot className="h-[4vh] w-[4vh]" />}
              </div>
              <div className="font-serif text-[2.2vh] text-text">
                {assistant ? '未配置立绘' : '未绑定默认助手'}
              </div>
              <p className="mt-[1vh] text-[1.35vh] leading-relaxed text-text-muted">
                {assistantError || (assistant ? '请在角色编辑里添加待机动作图片。' : '请在 Core 助手管理里设置默认助手。')}
              </p>
            </div>
          </div>
        )}

      </div>
    </aside>
  );
}
