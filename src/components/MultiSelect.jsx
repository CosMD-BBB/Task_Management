import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, LoaderCircle, Plus, Search, X } from 'lucide-react';
import './multi-select.css';

const initials = (name = '') => name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase();

function OptionMark({ option, variant }) {
  if (variant === 'assignee') return <span className="tm-multi-avatar" style={{ background: option.color || '#788aa7' }}>{initials(option.label)}</span>;
  return <span className="tm-multi-color-dot" style={{ background: option.color || '#7c69bd' }} />;
}

export default function MultiSelect({ label, value = [], options = [], onChange, onCreate, disabled = false, readonly = false, variant = 'tag', placeholder = 'เลือกตัวเลือก', onPendingChange, maxSelected = Infinity }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [createdOptions, setCreatedOptions] = useState([]);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const popupRef = useRef(null);
  const mountedRef = useRef(true);
  const creatingRef = useRef(false);
  const valueRef = useRef(value);
  const id = useId();
  valueRef.current = value;
  creatingRef.current = creating;

  const allOptions = useMemo(() => {
    const unique = new Map();
    for (const option of [...options, ...createdOptions]) {
      if (option?.value && !unique.has(option.value)) unique.set(option.value, option);
    }
    for (const selected of value) {
      if (!unique.has(selected)) unique.set(selected, { value: selected, label: variant === 'assignee' ? 'Former teammate' : selected });
    }
    return Array.from(unique.values());
  }, [options, createdOptions, value, variant]);
  const searchTerm = search.trim();
  const filteredOptions = allOptions.filter((option) => `${option.label} ${option.description || ''}`.toLocaleLowerCase().includes(searchTerm.toLocaleLowerCase()));
  const matchingOption = allOptions.find((option) => option.label.toLocaleLowerCase() === searchTerm.toLocaleLowerCase());
  const atLimit = value.length >= maxSelected;
  const canCreate = Boolean(onCreate && searchTerm && !matchingOption && !readonly && !atLimit);
  const selectedOptions = value.map((selected) => allOptions.find((option) => option.value === selected)).filter(Boolean);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    function outsideClick(event) {
      if (!creatingRef.current && !containerRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', outsideClick);
    return () => { window.clearTimeout(timer); document.removeEventListener('pointerdown', outsideClick); };
  }, [open]);

  function close(restoreFocus = false) {
    setOpen(false);
    setSearch('');
    setError('');
    if (restoreFocus) triggerRef.current?.focus();
  }

  function toggle(option) {
    if (disabled || creating || readonly) return;
    const current = valueRef.current;
    if (!current.includes(option.value) && current.length >= maxSelected) return;
    onChange?.(current.includes(option.value) ? current.filter((item) => item !== option.value) : [...current, option.value]);
    setError('');
  }

  function selectExisting(option) {
    if (disabled || creating || readonly || (atLimit && !valueRef.current.includes(option.value))) return;
    if (!valueRef.current.includes(option.value)) onChange?.([...valueRef.current, option.value]);
    setError('');
  }

  async function createOption() {
    if (!canCreate || creating || disabled) return;
    const newValue = searchTerm;
    setError('');
    setCreating(true);
    onPendingChange?.(true);
    try {
      const result = await onCreate(newValue);
      if (!mountedRef.current) return;
      const persistedOption = result?.value ? result : { value: newValue, label: newValue, color: variant === 'channel' ? '#477b9e' : '#7c69bd' };
      setCreatedOptions((current) => [...current, persistedOption]);
      if (!valueRef.current.includes(persistedOption.value)) onChange?.([...valueRef.current, persistedOption.value]);
      setSearch('');
    } catch (createError) {
      if (mountedRef.current) setError(createError?.message ? `เพิ่มตัวเลือกไม่สำเร็จ: ${createError.message}` : 'เพิ่มตัวเลือกไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      onPendingChange?.(false);
      if (mountedRef.current) {
        setCreating(false);
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
    }
  }

  function handleKey(event) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (creating) return;
      close(true);
      return;
    }
    const checkboxes = Array.from(popupRef.current?.querySelectorAll('input[type="checkbox"]:not([disabled])') || []);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const index = checkboxes.indexOf(document.activeElement);
      if (!checkboxes.length) return;
      const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : checkboxes.length - 1)
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + checkboxes.length) % checkboxes.length;
      checkboxes[next].focus();
    } else if (event.key === 'Enter' && event.target === searchRef.current) {
      event.preventDefault();
      if (matchingOption) selectExisting(matchingOption);
      else if (canCreate) createOption();
      else if (filteredOptions.length === 1) toggle(filteredOptions[0]);
    } else if (event.key === 'Enter' && event.target.type === 'checkbox') {
      event.preventDefault();
      event.target.click();
    }
  }

  return <div className={`tm-multi-select tm-multi-${variant} ${open ? 'tm-multi-is-open' : ''} ${readonly ? 'tm-multi-readonly' : ''}`} ref={containerRef} onKeyDown={handleKey}
    onBlur={(event) => { if (!creating && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <div className="tm-multi-control">
      <div className="tm-multi-selected" aria-label={`Selected ${label}`}>
        {selectedOptions.map((option) => <span className="tm-multi-chip" key={option.value} style={{ '--tm-chip-color': option.color || (variant === 'channel' ? '#477b9e' : '#7c69bd') }}>
          <OptionMark option={option} variant={variant} /><span className="tm-multi-chip-label" title={option.label}>{option.label}</span>
          {!readonly && <button type="button" aria-label={`Remove ${option.label} from ${label}`} disabled={disabled || creating} onClick={() => toggle(option)}><X size={11} /></button>}
        </span>)}
        {!selectedOptions.length && readonly && <span className="tm-multi-placeholder">{variant === 'assignee' ? 'Unassigned' : 'ยังไม่ได้เลือก'}</span>}
      </div>
      {!readonly && <button type="button" className={`tm-multi-trigger ${!selectedOptions.length ? 'tm-multi-trigger-empty' : ''}`} ref={triggerRef}
        aria-label={label} aria-expanded={open} aria-controls={`${id}-options`} disabled={disabled || creating}
        onClick={() => { if (open) close(); else { setSearch(''); setError(''); setOpen(true); } }}>
        {!selectedOptions.length ? <span>{placeholder}</span> : <Plus size={13} />}<ChevronDown size={13} />
      </button>}
    </div>
    {open && <div className="tm-multi-popup" id={`${id}-options`} ref={popupRef} role="group" aria-label={`${label} options`}>
      <div className="tm-multi-popup-heading"><span>{label}</span><small>เลือกได้หลายรายการ</small></div>
      <label className="tm-multi-search"><Search size={14} /><input ref={searchRef} aria-label={`Search ${label}`} placeholder={onCreate ? 'ค้นหา หรือพิมพ์ตัวเลือกใหม่…' : 'ค้นหาสมาชิก…'}
        value={search} maxLength={100} disabled={creating || disabled} onChange={(event) => { setSearch(event.target.value); setError(''); }} />
        {search && !creating && <button type="button" aria-label={`Clear search ${label}`} onClick={() => { setSearch(''); searchRef.current?.focus(); }}><X size={12} /></button>}
      </label>
      <div className="tm-multi-options">
        {filteredOptions.map((option) => <label className={`tm-multi-option ${value.includes(option.value) ? 'tm-multi-option-selected' : ''}`} key={option.value}>
          <input type="checkbox" aria-label={option.label} checked={value.includes(option.value)} disabled={disabled || creating || (atLimit && !value.includes(option.value))} onChange={() => toggle(option)} />
          <span className="tm-multi-checkbox"><Check size={11} strokeWidth={3} /></span><OptionMark option={option} variant={variant} />
          <span className="tm-multi-option-text"><span>{option.label}</span>{option.description && <small>{option.description}</small>}</span>
        </label>)}
        {!filteredOptions.length && <p className="tm-multi-no-results">{variant === 'assignee' ? 'ไม่พบสมาชิกที่ค้นหา' : 'ยังไม่มีตัวเลือกนี้'}</p>}
      </div>
      {onCreate && !readonly && <button type="button" className="tm-multi-create" disabled={!canCreate || creating || disabled} onClick={createOption}>
        {creating ? <LoaderCircle size={14} className="tm-multi-spin" /> : <Plus size={14} />}<span>{creating ? 'กำลังเพิ่มตัวเลือก…' : 'เพิ่มตัวเลือก'} {searchTerm ? <strong>“{searchTerm}”</strong> : <span>ใหม่ให้โปรเจกต์นี้</span>}</span>
      </button>}
      {atLimit && <p className="tm-multi-limit">เลือกได้สูงสุด {maxSelected} รายการ นำบางรายการออกเพื่อเลือกเพิ่มเติม</p>}
      {error && <p className="tm-multi-error" role="alert">{error}</p>}
      <div className="tm-multi-popup-footer"><span>เลือกแล้ว {value.length} รายการ</span><div>
        <button type="button" aria-label={`Clear ${label}`} disabled={!value.length || disabled || creating} onClick={() => onChange?.([])}>ล้าง</button>
        <button type="button" disabled={creating} onClick={() => close(true)}>เสร็จแล้ว</button>
      </div></div>
    </div>}
  </div>;
}
