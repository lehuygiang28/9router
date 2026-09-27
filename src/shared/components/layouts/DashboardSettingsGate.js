"use client";

import { use } from "react";
import PropTypes from "prop-types";
import { loadDashboardSettings } from "@/shared/settings/loadDashboardSettings";

export default function DashboardSettingsGate({ children }) {
  use(loadDashboardSettings());
  return children;
}

DashboardSettingsGate.propTypes = {
  children: PropTypes.node,
};
