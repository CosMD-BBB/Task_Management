import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BarChart3, Camera, Check, ChevronDown, Clapperboard, Facebook, FileText, Globe, Image, Images, Instagram, LoaderCircle, Music2, Plus, Search, ShoppingBag, X, Youtube } from 'lucide-react';
import { getTagAppearance, tagAppearanceStyle } from '../tagAppearance';
import './multi-select.css';

const initials = (name = '') => name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase();

function OptionMark({ option, variant }) {
  if (variant === 'assignee') return <span className="tm-multi-avatar" style={{ background: option.color || '#788aa7' }}>{initials(option.label)}</span>;
  return <ChoiceIcon option={option} variant={variant} />;
}

function ChoiceIcon({ option, variant }) {
  const icons = { Video: Clapperboard, VDO: Clapperboard, Reel: Clapperboard, 'Photo album': Images, Infographic: BarChart3, 'Single Post': Image, Story: Camera, Blog: FileText, 'ขายของ': ShoppingBag, Facebook, Instagram, TikTok: Music2, YouTube: Youtube, Website: Globe };
  const Icon = icons[option.value] || (variant === 'channel' ? Globe : FileText);
  return <span className="tm-multi-choice-icon" data-platform={variant === 'channel' ? option.value.toLocaleLowerCase() : undefined} aria-hidden="true">{variant === 'channel' && option.value.toLocaleLowerCase() === 'line' ? <b>LINE</b> : <Icon size={18} />}</span>;
}

export default function MultiSelect({ label, title, description, display = 'popup', value = [], options = [], onChange, onCreate, disabled = false, readonly = false, variant = 'tag', placeholder = 'เลือกตัวเลือก', onPendingChange, maxSelected = Infinity }) {
  const inline = display === 'inline';
  const tagKind = variant === 'channel' ? 'channel' : 'contentType';
  const optionStyle = (option) => variant === 'assignee' ? { '--chip-color': option.color || '#788aa7' } : tagAppearanceStyle(option.value, tagKind);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [newOption, setNewOption] = useState('');
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
  const creationTerm = inline ? newOption.trim() : searchTerm;
  const matchingCreation = allOptions.find((option) => option.label.toLocaleLowerCase() === creationTerm.toLocaleLowerCase());
  const atLimit = value.length >= maxSelected;
  const canCreate = Boolean(onCreate && creationTerm && !matchingCreation && !readonly && !atLimit);
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
    const newValue = creationTerm;
    setError('');
    setCreating(true);
    onPendingChange?.(true);
    try {
      const result = await onCreate(newValue);
      if (!mountedRef.current) return;
      const persistedOption = result?.value ? result : { value: newValue, label: newValue, color: getTagAppearance(newValue, tagKind).color };
      setCreatedOptions((current) => [...current, persistedOption]);
      if (!valueRef.current.includes(persistedOption.value)) onChange?.([...valueRef.current, persistedOption.value]);
      setSearch('');
      setNewOption('');
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
    if (inline) {
      if (event.key === 'Enter' && event.target.getAttribute('aria-label') === `New ${label} option`) {
        event.preventDefault();
        createOption();
      }
      return;
    }
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

  const selectedChips = <div className="tm-multi-selected" aria-label={`Selected ${label}`}>
    {selectedOptions.map((option) => <span className="tm-multi-chip" key={option.value} style={optionStyle(option)} data-tag-value={variant === 'assignee' ? undefined : option.value} data-tag-kind={variant === 'assignee' ? undefined : tagKind}>
      <OptionMark option={option} variant={variant} /><span className="tm-multi-chip-label" title={option.label}>{option.label}</span>
      {!readonly && <button type="button" aria-label={`Remove ${option.label} from ${label}`} disabled={disabled || creating} onClick={() => toggle(option)}><X size={13} /></button>}
    </span>)}
    {!selectedOptions.length && <span className="tm-multi-placeholder">{variant === 'assignee' ? 'ยังไม่มีผู้รับผิดชอบ' : 'ยังไม่ได้เลือก — กดตัวเลือกด้านล่างได้เลย'}</span>}
  </div>;

  if (inline) return <section className={`tm-multi-select tm-multi-inline tm-multi-${variant} ${readonly ? 'tm-multi-readonly' : ''}`} ref={containerRef} onKeyDown={handleKey}
    role="group" aria-label={`${label} options`}>
    <div className="tm-multi-inline-heading"><div><span className="tm-multi-eyebrow">{label}</span><h3>{title || label}</h3><p>{description}</p></div><span className="tm-multi-count" aria-live="polite">เลือก {value.length}</span></div>
    <div className="tm-multi-inline-summary">{selectedChips}</div>
    <div className="tm-multi-choices-caption"><span>เลือกได้หลายรายการ</span>{!readonly && <button type="button" aria-label={`Clear ${label}`} disabled={!value.length || disabled || creating} onClick={() => onChange?.([])}>ล้างที่เลือก</button>}</div>
    <label className="tm-multi-search tm-multi-inline-search"><Search size={16} /><input ref={searchRef} aria-label={`Search ${label}`} placeholder="ค้นหาตัวเลือก…"
      value={search} maxLength={100} disabled={creating || disabled} onChange={(event) => setSearch(event.target.value)} />
      {search && !creating && <button type="button" aria-label={`Clear search ${label}`} onClick={() => { setSearch(''); searchRef.current?.focus(); }}><X size={14} /></button>}
    </label>
    <div className="tm-multi-inline-options">
      {filteredOptions.map((option) => <label className={`tm-multi-choice ${value.includes(option.value) ? 'tm-multi-choice-selected' : ''}`} key={option.value} style={optionStyle(option)} data-tag-value={option.value} data-tag-kind={tagKind}>
        <input type="checkbox" aria-label={option.label} checked={value.includes(option.value)} disabled={readonly || disabled || creating || (atLimit && !value.includes(option.value))} onChange={() => toggle(option)} />
        <ChoiceIcon option={option} variant={variant} /><span className="tm-multi-choice-text"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
        <span className="tm-multi-checkbox"><Check size={13} strokeWidth={3} /></span>
      </label>)}
      {!filteredOptions.length && <p className="tm-multi-no-results">ไม่พบตัวเลือก ลองค้นหาด้วยคำอื่น หรือเพิ่มตัวเลือกใหม่ด้านล่าง</p>}
    </div>
    {onCreate && !readonly && <div className="tm-multi-custom-option"><label htmlFor={`${id}-new`}>เพิ่มตัวเลือกของทีม</label><div>
      <input id={`${id}-new`} aria-label={`New ${label} option`} placeholder={variant === 'channel' ? 'เช่น Shopee Live, งานอีเวนต์' : 'เช่น รีวิวสินค้า, ขายของ'} value={newOption} maxLength={100} disabled={creating || disabled || atLimit} onChange={(event) => { setNewOption(event.target.value); setError(''); }} />
      <button type="button" aria-label={`Add ${label} option`} className="tm-multi-create" disabled={!canCreate || creating || disabled} onClick={createOption}>{creating ? <LoaderCircle size={16} className="tm-multi-spin" /> : <Plus size={16} />}<span>{creating ? 'กำลังเพิ่ม' : 'เพิ่ม'}</span></button>
    </div><small>{matchingCreation && creationTerm ? 'มีตัวเลือกนี้แล้ว เลือกจากรายการด้านบนได้เลย' : 'ตัวเลือกใหม่จะใช้ต่อในโปรเจกต์นี้ได้ และเลือกให้งานนี้ทันที'}</small></div>}
    {atLimit && <p className="tm-multi-limit">เลือกได้สูงสุด {maxSelected} รายการ นำบางรายการออกเพื่อเลือกเพิ่มเติม</p>}
    {error && <p className="tm-multi-error" role="alert">{error}</p>}
  </section>;

  return <div className={`tm-multi-select tm-multi-${variant} ${open ? 'tm-multi-is-open' : ''} ${readonly ? 'tm-multi-readonly' : ''}`} ref={containerRef} onKeyDown={handleKey}
    onBlur={(event) => { if (!creating && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <div className="tm-multi-control">
      {(selectedOptions.length > 0 || readonly) && selectedChips}
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
        {filteredOptions.map((option) => <label className={`tm-multi-option ${value.includes(option.value) ? 'tm-multi-option-selected' : ''}`} key={option.value} style={optionStyle(option)}>
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
