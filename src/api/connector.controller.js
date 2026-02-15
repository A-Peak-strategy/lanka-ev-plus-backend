import * as connectorService from "../services/connector.service.js";

export const getConnectorStatus = async (req, res) => {
  try {
    const { chargerId, connectorId } = req.params;

    if (!chargerId || !connectorId) {
      return res.status(400).json({
        success: false,
        message: "chargerId and connectorId are required"
      });
    }

    const connector = await connectorService.findConnectorStatus(
      chargerId,
      parseInt(connectorId)
    );

    if (!connector) {
      return res.status(404).json({
        success: false,
        message: "Connector not found"
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        chargerId: connector.chargerId,
        connectorId: connector.connectorId,
        status: connector.status,
        errorCode: connector.errorCode,
        updatedAt: connector.updatedAt
      }
    });

  } catch (error) {
    console.error("Get connector status error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};
