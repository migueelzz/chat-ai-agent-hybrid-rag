import { Button } from '@/components/ui/button'

const SUGGESTIONS = [
  { prompt: 'Como realizar lançamentos contábeis no módulo FI?' },
  { prompt: 'Como criar um pedido de compra no módulo MM?' },
  { prompt: 'Qual o processo de faturamento no módulo SD?' },
  { prompt: 'Como criar uma CDS View no SAP S/4HANA?' },
  { prompt: 'Quais as principais tabelas do módulo FI no SAP?' },
]

interface SuggestionChipsProps {
  onSelect: (prompt: string) => void
}

export function SuggestionChips({ onSelect }: SuggestionChipsProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2 mt-4">
      {SUGGESTIONS.map((s) => (
        <Button
          key={s.prompt}
          variant="outline"
          size="sm"
          onClick={() => onSelect(s.prompt)}
          className="rounded-full max-w-44 text-xs text-muted-foreground border-border/60 hover:border-border hover:text-foreground"
        >
          <span className='truncate'>
            {s.prompt}
          </span>
        </Button>
      ))}
    </div>
  )
}
