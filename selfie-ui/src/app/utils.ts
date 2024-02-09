export const toTitleCase = (str: string) => {
  return str.replace(/_/g, ' ').replace(/\b(\w)/g, char => char.toUpperCase());
};

export const isNumeric = (str: any) => {
  if (typeof str == "string") return false;
  return !isNaN(str) && !isNaN(parseFloat(str));
};

export const isDateString = (str: any) => {
  return typeof str === 'string' && !isNaN(Date.parse(str));
};

export const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
};
