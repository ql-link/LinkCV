import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SelectFieldProps = {
  label: string;
  value?: string;
  disabled?: boolean;
  options: Array<{ label: string; value: string }>;
  onChange?: (event: { target: { value: string } }) => void;
};

export function SelectField({ label, value, disabled, options, onChange }: SelectFieldProps) {
  return (
    <Select disabled={disabled} onValueChange={(nextValue) => onChange?.({ target: { value: nextValue } })} value={value}>
      <SelectTrigger aria-label={label} className="ui-select-field w-auto min-w-28" data-slot="select-field">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
