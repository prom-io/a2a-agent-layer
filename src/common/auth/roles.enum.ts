export enum Role {
  /** Autonomous agent acting on its own behalf. */
  AGENT = 'agent',
  /** Human or system operator managing a fleet of agents. */
  OPERATOR = 'operator',
  /** Full administrative access to the layer. */
  ADMIN = 'admin',
  /** Internal service-to-service caller (payment rail, verification network). */
  SERVICE = 'service',
}
