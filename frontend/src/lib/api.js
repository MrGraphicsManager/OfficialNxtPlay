import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const api = axios.create({ baseURL: API });

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("nxp_token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export const errMsg = (e) => {
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) {
    return d.map((x) => {
      const field = x.loc?.slice(-1)[0] || "";
      const msg = x.msg || "";
      if (field === "stakeholder_pan" || field === "business_pan") {
        return `${field === "stakeholder_pan" ? "Owner PAN" : "Business PAN"} must be 10 characters (5 letters, 4 numbers, 1 letter, e.g. ABCDE1234F)`;
      }
      if (field === "ifsc_code") {
        return "IFSC code must be 11 characters (e.g. HDFC0001234)";
      }
      if (field === "phone") {
        return "Mobile number must be a valid 10-digit Indian number (starting with 6-9)";
      }
      if (field === "postal_code") {
        return "PIN code must be a 6-digit number (e.g. 396424)";
      }
      if (field === "account_number") {
        return "Bank account number must be between 9 and 18 digits";
      }
      if (field === "gst") {
        return "GSTIN must be 15 characters (e.g. 24AAAAA0000A1Z5)";
      }
      if (typeof msg === "string" && msg.includes("should match pattern")) {
        return `${field.replace(/_/g, " ")} format is invalid`;
      }
      return `${field ? field.replace(/_/g, " ") + ": " : ""}${msg}`;
    }).join(", ");
  }
  return d || e?.message || "Something went wrong";
};

export const imgUrl = (id) => `${API}/images/${id}`;
