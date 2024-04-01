from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Extra

from selfie.config import AppConfig
from selfie.database import DataManager

router = APIRouter(tags=["Configuration"])


class Settings(BaseModel):
    method: Optional[str] = None
    model: Optional[str] = None
    environment_variables: Optional[dict] = None
    gpu: Optional[bool] = None

    class Config:
        extra = Extra.allow


@router.put("/settings",
            tags=["Configuration"],
            description="Update the settings of the Selfie instance.",
            status_code=204)
async def update_settings(request: Settings):
    settings_dict = request.dict(exclude_unset=True, exclude_none=True)
    manager = DataManager()
    manager.save_settings(settings_dict, delete_others=True)
    AppConfig.reload()


@router.get("/settings",
            tags=["Configuration"],
            description="Get the settings of the Selfie instance.")
async def get_settings():
    manager = DataManager()
    settings_dict = manager.get_settings()
    return Settings(**settings_dict)
