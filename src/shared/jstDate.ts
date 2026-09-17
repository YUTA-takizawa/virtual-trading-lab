export function todayJstDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(date); // sv-SE locale formats as YYYY-MM-DD
}
